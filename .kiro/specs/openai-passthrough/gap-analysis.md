# ギャップ分析: OpenAI Passthrough 機能

## 1. 分析サマリー

OpenAI 本家 API へのパススルー機能を実装するためのギャップ分析を実施しました。

- **スコープ**: `model` 名に基づくリクエストの振り分け（Antigravity vs OpenAI）、OpenAI へのリクエスト中継の実装。
- **特定された課題**:
  - `ModelRoutingService` の役割は現在「同一プロバイダー内でのモデル置換」であり、プロバイダー自体の切り替えは考慮されていない。
  - `ModelCatalog` が Antigravity 向けモデルしか返さない（OpenAI モデルが一覧に含まれない可能性）。
  - `TransformService` は Antigravity への変換・送信に特化しており、OpenAI 向けのパススルーロジックとは互換性がない。
- **推奨アプローチ**: **Router レベルでの分岐（Option B）**。
  - `proxy-router.ts` で分岐ロジックを追加し、既存の `TransformService` と新設する `OpenAIService` を切り替える構成が最もクリーンで安全です。

## 2. 現状調査 (Current State)

### 主要コンポーネント
- **src/proxy/proxy-router.ts**: エントリーポイント。リクエスト受信、バリデーション、変換、応答を行う。現在は `TransformService` に全権委譲している。
- **src/proxy/model-routing-service.ts**: リクエスト内容（エイリアス）を見て `model` フィールドを書き換える。
- **src/proxy/transform-service.ts**: Antigravity へのプロトコル変換とリクエスト送信を行う。
- **src/config/model-settings-service.ts**: 利用可能なモデルの一覧（`ModelCatalog`）を提供する。現在は固定リスト + カスタム設定。

### 依存関係とパターン
- **DI パターン**: 各サービスはファクトリー関数 (`create...Service`) で生成され、オプションで注入される。
- **Hono**: HTTP サーバーとして使用。
- **Zod**: スキーマ検証。

## 3. 要件とのギャップ分析

### Requirement 1: 環境設定と認証キー
- **要件**: `OPENAI_API_KEY` 環境変数の読み込みと使用。
- **現状**: 現在は Google Cloud のアクセストークン管理 (`TokenStore`) のみ。
- **ギャップ**: `OPENAI_API_KEY` を安全に読み込み、提供する設定サービス（または定数管理）が必要。
- **判定**: **Missing**（新規追加が必要）

### Requirement 2: モデル名によるルーティング
- **要件**: `model` 名に `gemini`/`claude` が含まれる場合は Antigravity、それ以外は OpenAI へ。
- **現状**: `proxy-router.ts` は無条件で `TransformService` を呼び出している。`ModelRoutingService` は同一フロー内でのモデルID書き換えのみを行う。
- **ギャップ**: `proxy-router.ts` レベルでの条件分岐ロジックが必要。
- **判定**: **Constraint**（既存ロジックの変更が必要）

### Requirement 3: OpenAI パススルーの忠実性
- **要件**: スキーマ変換なし、ヘッダー保持、ストリーミング透過。
- **現状**: `TransformService` は強制的に Antigravity 形式へ変換する。
- **ギャップ**: 変換を行わずに OpenAI エンドポイントへフェッチする新しいサービス (`OpenAIService`) が必要。`proxy-router.ts` のレスポンス処理も、変換結果 (`Result<T, E>`) を前提としているため、パススルー応答を扱えるように調整が必要。
- **判定**: **Missing**（新規コンポーネントが必要）

### Requirement 4: エラー処理
- **要件**: OpenAI からのエラーをそのまま（あるいは適切にラップして）返す。
- **現状**: `proxy-router.ts` のエラーハンドリングは `normalizeTransformResult` や `resolveProxyErrorMapping` など Antigravity 特有のエラー構造に依存している部分がある。
- **ギャップ**: OpenAI からのエラーレスポンスを既存のリクエストハンドラーが理解できる形式に合わせるか、分岐先で独自にレスポンスを生成する必要がある。
- **判定**: **Constraint**（エラーハンドリングの共通化または分岐）

### Requirement 5: 透過性と設定簡素化
- **要件**: `/v1/chat/completions` 単一エンドポイント。
- **現状**: エンドポイントは既に存在する。
- **ギャップ**: `v1/models` エンドポイントが Antigravity のモデルしか返さないため、クライアントが OpenAI モデルを認識できない可能性がある（ただし、クライアント側で手動指定する場合は動作する）。
- **判定**: **Constraint**（カタログへの OpenAI モデル追加機能は要件に含まれていないが、ユーザー体験向上のために検討余地あり）

## 4. 実装アプローチの検討

### Option A: TransformService の拡張
`TransformService` 内部で分岐し、OpenAI ターゲットの場合は変換をスキップして送信する。
- **メリット**: `proxy-router.ts` を変更しなくて済む。
- **デメリット**: `TransformService`（変換サービス）という名前に反する責務を持つことになる。複雑度が上がり、テストが困難になる。
- **判定**: 推奨しない。

### Option B: Router レベルでの分岐 (推奨)
`proxy-router.ts` で `model` 文字列を検査し、`TransformService` か `OpenAIService` (新規) のどちらを呼ぶか決定する。
- **メリット**: 責務が明確。Antigravity 関連のロジックに影響を与えない。
- **デメリット**: `proxy-router.ts` のロジックが少し増える。
- **判定**: **採用**。最もクリーンで安全。

## 5. 推奨設計 (Design Recommendations)

### アーキテクチャ
1. **`OpenAIService` の新設**:
   - `src/proxy/openai-service.ts`
   - コンストラクタで API キーを受け取る。
   - `handleCompletion(request: Request, body: JsonBody): Promise<Response>` を持つ。
   - シンプルな `fetch` ラッパーとして実装。

2. **`ConfigService` の拡張**:
   - `src/config/openai-config.ts` (または類似)
   - `OPENAI_API_KEY` の読み込み。

3. **`ProxyRouter` の改修**:
   - `createProxyApp` オプションに `openaiService` を追加。
   - `POST /v1/chat/completions` ハンドラー内で分岐。

### Router 分岐ロジック案
```typescript
// modelRoutingService (Alias解決) の後に判定
const routingResult = options.modelRoutingService?.route(parsed.data);
const routedRequest = routingResult?.request ?? parsed.data;

if (shouldRouteToOpenAI(routedRequest.model)) {
    return options.openaiService.handleCompletion(c.req.raw, routedRequest);
} else {
    // 既存の Antigravity フロー
    return options.transformService.handleCompletion(routedRequest);
}
```

### OpenAI モデルのディスカバリー対応
**選択したアプローチ**: フォローアップタスクとして追跡

- **現状**: `GET /v1/models` エンドポイントは Antigravity モデルのみを返す。
- **影響**: クライアントは OpenAI モデルを自動検出できない。ただし、クライアント側で手動指定すれば動作する。
- **判定**: 本フェーズでは `/v1/chat/completions` のルーティング機能に集中し、モデルカタログへの OpenAI モデル追加は後続タスクとして扱う。
- **フォローアップタスク**:
  1. `ModelCatalog` に OpenAI モデルエントリ（例: `gpt-4`, `gpt-3.5-turbo`）を追加する設計。
  2. `GET /v1/models` レスポンスに OpenAI モデルを含める実装。
  3. OpenAI API からの動的モデル取得（オプション）を検討。

### 労力とリスク
- **Effort**: **S (1-3 days)** - ロジックは単純で、既存コードへの侵襲も少ない。
- **Risk**: **Low** - 既存の Antigravity フローは if 文の else ブロックに入るだけであり、影響を受けにくい。

## 6. 次のステップ

1. `/kiro-spec-design openai-passthrough` を実行し、詳細設計を生成する。
