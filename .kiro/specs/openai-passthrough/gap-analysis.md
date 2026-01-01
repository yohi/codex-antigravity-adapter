# ギャップ分析: OpenAI Passthrough 機能

## 1. 分析サマリー

OpenAI 本家 API へのパススルー機能を実装するためのギャップ分析を実施しました。

- **スコープ**: `model` 名に基づくリクエストの振り分け（Antigravity vs 上位サーバー）、および上位サーバーへのリクエスト透過中継の実装。これには `OPENAI_BASE_URL` 対応と Auth Passthrough モードが含まれる。
- **特定された課題**:
  - `ModelRoutingService` の役割は現在「同一プロバイダー内でのモデル置換」であり、プロバイダー自体の切り替えは考慮されていない。
  - `ModelCatalog` が Antigravity 向けモデルしか返さない（OpenAI モデルが一覧に含まれない可能性）。- フォローアップタスク。
  - **New**: `OPENAI_API_KEY` 未設定時のヘッダー制御ロジック（Auth Passthrough）を `OpenAIPassthroughService` に実装する必要がある。
  - **New**: `OPENAI_BASE_URL` に対応した接続先変更ロジックが必要。
- **推奨アプローチ**: **Router レベルでの分岐（Option B）**。
  - `proxy-router.ts` で分岐ロジックを追加し、既存の `TransformService` と新設する `OpenAIPassthroughService` を切り替える構成が最もクリーンで安全です。

## 2. 現状調査 (Current State)

### 主要コンポーネント
- **src/proxy/proxy-router.ts**: エントリーポイント。リクエスト受信、バリデーション、変換、応答を行う。`Authorization` ヘッダーを含む生リクエスト (`c.req.raw`) にアクセス可能であり、パススルー実装に適している。
- **src/proxy/model-routing-service.ts**: リクエスト内容（エイリアス）を見て `model` フィールドを書き換える。
- **src/proxy/transform-service.ts**: Antigravity へのプロトコル変換とリクエスト送信を行う。
- **src/config/model-settings-service.ts**: 利用可能なモデルの一覧（`ModelCatalog`）を提供する。

### 依存関係とパターン
- **DI パターン**: 各サービスはファクトリー関数 (`create...Service`) で生成され、オプションで注入される。
- **Hono**: HTTP サーバーとして使用。`c.req.raw` から `Authorization` ヘッダーを取得可能。

## 3. 要件とのギャップ分析

### Requirement 1: 環境設定と認証キー・接続先
- **要件**: `OPENAI_API_KEY`, `OPENAI_BASE_URL` 環境変数のサポート。`OPENAI_API_KEY` 未設定時の Auth Passthrough。
- **現状**: 現在は Google Cloud トークンのみ。環境変数管理は `Bun.env` で直接行われるか、個別の場所にある。
- **ギャップ**: `OPENAI_API_KEY` と `OPENAI_BASE_URL` を読み込む `OpenAIConfigService` が必要。Base URL のデフォルト値 (`https://api.openai.com`) 管理が必要。
- **判定**: **Missing**（新規追加が必要）

### Requirement 2: モデル名によるルーティング
- **要件**: `model` 名に `gemini`/`claude` が含まれる場合は Antigravity、それ以外は上位サーバーへ。
- **現状**: `proxy-router.ts` は無条件で `TransformService` を呼び出している。
- **ギャップ**: `proxy-router.ts` レベルでの条件分岐ロジックが必要。
- **判定**: **Constraint**（既存ロジックの変更が必要）

### Requirement 3: パススルーの忠実性 (Auth Passthrough 含む)
- **要件**: スキーマ変換なし、ヘッダー保持（ただし Host/Content-Length 除外）、ストリーミング透過。認証ヘッダーは設定有無で切り替え。
- **現状**: `TransformService` は強制的に Antigravity 形式へ変換する。
- **ギャップ**:
  - 変換を行わずに上位サーバーへフェッチする新しいサービス (`OpenAIPassthroughService`) が必要。
  - クライアントリクエストの `Authorization` ヘッダーを conditionally に転送するロジックが必要。
  - レスポンスをそのまま返す (`return new Response(...)`) 処理が必要。
- **判定**: **Missing**（新規コンポーネントが必要）

### Requirement 4: エラー処理
- **要件**: 上位サーバーからのエラーをそのまま返す。Router 独自エラーは OpenAI 互換形式。
- **現状**: 既存のエラーハンドリングは Antigravity 用にラップされている。
- **ギャップ**: 上位サーバーからのレスポンスをバイパスしてクライアントに返すパスが必要。Router 独自エラー（ネットワークタイムアウトなど）は `createOpenAIError` ヘルパーで生成する必要がある。
- **判定**: **Constraint**（エラーハンドリングの共通化または分岐）

### Requirement 5: 透過性と設定簡素化
- **要件**: `/v1/chat/completions` 単一エンドポイント。
- **現状**: エンドポイントは既に存在する。
- **ギャップ**: 特になし。

## 4. 実装アプローチの検討

### Option A: TransformService の拡張
- **判定**: 推奨しない（責務過多）。

### Option B: Router レベルでの分岐 (推奨)
`proxy-router.ts` で `model` 文字列を検査し、`TransformService` か `OpenAIPassthroughService` (新規) のどちらを呼ぶか決定する。Auth Passthrough は `OpenAIPassthroughService` 内部、または呼び出し前のロジックで制御可能だが、Service 内部に隠蔽するのが望ましい。

- **メリット**: 責務が明確。Antigravity 関連のロジックに影響を与えない。
- **デメリット**: `proxy-router.ts` のロジックが少し増える。
- **判定**: **採用**。

## 5. 推奨設計 (Design Recommendations)

### アーキテクチャ
1. **`OpenAIPassthroughService` の新設**:
   - `src/proxy/openai-passthrough-service.ts`
   - 依存: `OpenAIConfigService`, `fetch`
   - 責務:
     - `configService.getBaseUrl()` を使用してリクエスト先を決定。
     - `configService.getApiKey()` がある場合は `Authorization` を上書き、なければ元のヘッダーを使用。
     - ストリーミングを含むレスポンスの透過中継。

2. **`OpenAIConfigService` の新設**:
   - `src/config/openai-config-service.ts`
   - `OPENAI_API_KEY`, `OPENAI_BASE_URL` の読み込み。

3. **`ProxyRouter` の改修**:
   - `createProxyApp` オプションに `openaiService` を追加。
   - `POST /v1/chat/completions` ハンドラー内で `shouldRouteToOpenAI` (Utility) を使用して分岐。

### 労力とリスク
- **Effort**: **S (1-3 days)** - Auth Passthrough や Base URL 対応が増えたが、基本ロジックは単純。
- **Risk**: **Low** - 既存機能への影響は限定的。

## 6. 次のステップ

1. `/kiro-spec-design openai-passthrough` を実行し、詳細設計を生成する（既に生成・更新済み）。
