# Gap Analysis: OpenAI Passthrough

## 1. Analysis Summary
- **概要**: 既存の Antigravity 変換フローに加えて、OpenAI 互換エンドポイントへの透過パススルー経路を追加する必要がある。
- **主要課題**: `proxy-router.ts` のスキーマ検証が厳格で、OpenAI パススルー要求（未知フィールド含む）を拒否する可能性が高い。
- **主要課題**: `model` 欠落時のエラー形式が要件の OpenAI 互換形式と一致しない。
- **主要課題**: `OPENAI_API_KEY`/`OPENAI_BASE_URL` の設定・ヘッダー制御・透過転送の実装が存在しない。
- **推奨**: ルーター分岐＋新規パススルーサービス（Option B）を中心に設計し、既存の TransformService とは分離する。

## 2. Current State Investigation
- **コード構造**: `src/proxy/proxy-router.ts` が `/v1/chat/completions` を受け、`ChatCompletionRequestSchema` で検証後 `TransformService` に固定で委譲している。
- **再利用可能コンポーネント**:
  - `src/proxy/transform-service.ts`: Antigravity 向け変換・送信・レスポンス変換に特化。
  - `src/proxy/model-routing-service.ts`: メッセージ内エイリアスによるモデル置換に限定。
  - `src/main.ts`: DI とアプリ合成の起点として拡張可能。
- **規約確認**: Hono + Bun + TypeScript、`fetch` を標準 API として使用。サービスは factory で注入する構成。

## 3. Requirement-to-Asset Map

| 要件 | 既存資産 | ギャップ |
| --- | --- | --- |
| Req1: 環境設定と認証キー | `Bun.env` 参照の実装は散在するが OpenAI 用設定は無し | `OPENAI_API_KEY`/`OPENAI_BASE_URL` の統一管理が欠如 |
| Req2: モデル名ルーティング | `model-routing-service.ts` はエイリアスのみ | `gemini/claude` 判定で Antigravity / その他 OpenAI の分岐が未実装 |
| Req3: パススルー忠実性 | N/A | クライアントボディとストリームをそのまま中継するロジックが未実装 |
| Req4: エラー処理 | `resolveProxyErrorMapping` 等 | OpenAI 標準エラーへのマッピングとパススルー時の verbatim 中継が未実装 |
| Req5: 透過性 | `proxy-router.ts` | 既存エンドポイント上での動的分岐処理が必要 |

## 4. Implementation Approach Options

### Option A: 既存コンポーネントの拡張
- `TransformService` に OpenAI パススルー処理を追加し、内部で条件分岐。
- **利点**: 呼び出し側の変更が少ない。
- **欠点**: Antigravity 変換と OpenAI 透過が混在し責務が崩れる。エラー処理の分離が難しい。

### Option B: 新規コンポーネントの作成（推奨）
- `OpenAIPassthroughService` を新設し、`proxy-router.ts` でモデル名に応じて分岐。
- **利点**: 責務分離が明確。既存 Antigravity 変換に影響を最小化。
- **欠点**: DI 配線と新規サービスの実装が必要。

### Option C: ハイブリッド・アプローチ
- ルーティング判定は `proxy-router.ts`、共通ヘッダー整形やエラーフォーマットは `utils` として共有。
- **利点**: 共有部の重複を削減。
- **欠点**: 共通化しすぎると双方の要件差異が埋もれる。

## 5. Implementation Complexity & Risk

### 5.1 Effort Estimation Criteria

| Size | Person-Days | Story Points | Description |
|------|-------------|--------------|-------------|
| **S** (Small) | 1-2 days | 1-3 points | 単一コンポーネントの追加または既存コンポーネントの小規模修正。テストケース 5 個以下。 |
| **M** (Medium) | 3-5 days | 5-8 points | 複数コンポーネントの追加または既存フローの中規模修正。統合テストが必要。テストケース 10-20 個。 |
| **L** (Large) | 6-10 days | 13-21 points | アーキテクチャ変更を伴う大規模実装。E2E テスト、パフォーマンステスト、セキュリティレビューが必要。テストケース 30 個以上。 |

### 5.2 Risk Categories

| Risk Level | Criteria | Mitigation Strategy |
|------------|----------|---------------------|
| **Low** | 既存コードへの影響が限定的。ロールバックが容易。 | 標準的な単体テスト + 統合テスト |
| **Medium** | 既存フローの修正が必要。複数コンポーネント間の協調が必要。 | 回帰テスト + 段階的デプロイ + フィーチャーフラグ |
| **High** | コアアーキテクチャの変更。広範囲の影響。複雑な状態管理。 | 包括的テスト + カナリアデプロイ + ロールバック計画 + セキュリティレビュー |

### 5.3 Identified Risks

#### 5.3.1 Design & Architecture Risks

| Risk | Severity | Impact | Mitigation |
|------|----------|--------|------------|
| **スキーマ検証の分離** | Medium | `ChatCompletionRequestSchema` が OpenAI パススルーで未知フィールドを拒否する可能性 | 経路別スキーマ（`OpenAIPassthroughRequestSchema` with `.passthrough()`）の導入 |
| **レスポンス透過ロジック** | Medium | 上流エラー（4xx/5xx）を正しく透過せず、ルーターが独自エラーを生成してしまうリスク | 明示的な透過条件（HTTP レスポンス受信時は verbatim 返却）をコード化 |
| **ストリーミング処理** | High | ストリーム開始後のエラー検出・ロギングが困難。接続切断時の挙動が不明瞭。 | 透過中継を優先し、ストリーム開始後はクライアント側で処理（設計判断として明文化） |
| **モデルエイリアス解決の一貫性** | Low | Antigravity と OpenAI で異なる動作になる可能性 | `ModelRoutingService` をルーティング判定前に適用（両経路で統一） |

#### 5.3.2 Integration & Testing Risks

| Risk | Severity | Impact | Mitigation |
|------|----------|--------|------------|
| **Router 改修の影響範囲** | Medium | 既存 Antigravity フローに予期しない副作用が発生する可能性 | 回帰テスト（既存テストスイートを全実行） + 分岐ロジックの明確な分離 |
| **環境変数の管理** | Low | `OPENAI_API_KEY` 未設定時の動作が不明瞭 | Auth Passthrough モードを明示的にサポート + 設定検証ロジック |
| **E2E テストの複雑さ** | Medium | 実際の OpenAI API との統合テストが必要だが、コストと安定性の課題 | モックサーバー（`Bun.serve`）を使用 + 環境変数 `RUN_E2E=1` でオプトイン |
| **ヘッダー処理の互換性** | Low | クライアントヘッダーの保持・削除ロジックが正しく動作しない可能性 | 単体テスト（ヘッダー処理専用） + 統合テスト |

#### 5.3.3 Security & Compliance Risks

| Risk | Severity | Impact | Mitigation |
|------|----------|--------|------------|
| **API キーの露出** | High | `OPENAI_API_KEY` がログやレスポンスに露出する可能性 | ロギング時のマスキング + セキュリティレビュー |
| **Auth Passthrough の脆弱性** | Medium | クライアントの `Authorization` ヘッダーを無制限に転送することによるセキュリティリスク | Server Auth モード（`OPENAI_API_KEY` 設定）を推奨 + ドキュメント化 |

### 5.4 Option-by-Option Complexity & Risk Comparison

#### Option A: 既存コンポーネントの拡張

| Metric | Value | Notes |
|--------|-------|-------|
| **Effort** | **3-4 days** (M) | `TransformService` 内に条件分岐を追加。ヘッダー処理、エラーフォーマットを実装。 |
| **Story Points** | **5-8 points** | 中規模実装。既存ロジックとの混在により複雑度が増加。 |
| **Risk Level** | **High** | Antigravity 変換と OpenAI 透過が混在し、責務が不明瞭。既存テストの保守性が低下。 |
| **Key Risks** | - 責務の混在<br>- エラー処理の複雑化<br>- テストケースの肥大化 | TransformService が「変換」と「透過」の両方を担当するため、コードの可読性と保守性が低下。 |
| **Mitigation** | - 内部で明確な分岐を実装<br>- 既存テストへの影響を最小化 | 実装の複雑さとリスクから**非推奨**。 |

#### Option B: 新規コンポーネントの作成（推奨）

| Metric | Value | Notes |
|--------|-------|-------|
| **Effort** | **4-5 days** (M) | 新規 `OpenAIPassthroughService` + `OpenAIConfigService` を実装。Router 分岐ロジックを追加。 |
| **Story Points** | **5-8 points** | 中規模実装。責務分離により既存コードへの影響が最小。 |
| **Risk Level** | **Medium** | Router 改修の影響範囲が限定的。既存フローとの分離により回帰リスクが低い。 |
| **Key Risks** | - Router 分岐ロジックの実装ミス<br>- 経路別スキーマの誤適用<br>- DI 配線の複雑化 | 分岐ロジックが正しく動作しない場合、意図しない経路に転送される可能性。 |
| **Mitigation** | - ルーティング判定の単体テスト<br>- 回帰テスト（既存 Antigravity フロー）<br>- 統合テスト（両経路） | 責務分離とテスト容易性から**推奨**。 |
| **Components** | - `OpenAIPassthroughService` (新規)<br>- `OpenAIConfigService` (新規)<br>- `shouldRouteToOpenAI` (新規)<br>- `proxy-router.ts` (拡張) | 各コンポーネントが明確な責務を持ち、テスト・保守が容易。 |

#### Option C: ハイブリッド・アプローチ

| Metric | Value | Notes |
|--------|-------|-------|
| **Effort** | **5-6 days** (M-L) | Option B の実装 + 共通ユーティリティ（ヘッダー処理、エラーフォーマット）の抽出と設計。 |
| **Story Points** | **8-13 points** | 中〜大規模実装。共通化の設計と実装に追加工数が必要。 |
| **Risk Level** | **Medium-High** | 共通化の範囲と境界を誤ると、Antigravity と OpenAI の要件差異が埋もれるリスク。 |
| **Key Risks** | - 共通化による過剰な抽象化<br>- 要件差異の埋没<br>- テストケースの複雑化 | 共通ユーティリティの設計ミスにより、両経路に影響が波及する可能性。 |
| **Mitigation** | - 共通化の範囲を最小限に限定<br>- 経路ごとの統合テスト<br>- 共通ユーティリティの単体テスト | 現時点では**過剰設計**。将来的に類似経路が増えた場合に再検討。 |

### 5.5 Recommended Approach

**推奨: Option B（新規コンポーネントの作成）**

- **理由**:
  - 責務分離が明確（Antigravity 変換 vs OpenAI 透過）
  - 既存コードへの影響が最小（回帰リスク低）
  - テスト容易性が高い（各コンポーネントを独立してテスト可能）
  - 工数とリスクのバランスが良好（M サイズ、Medium リスク）

- **実装順序**:
  1. `OpenAIConfigService` の実装（環境変数管理）
  2. `OpenAIPassthroughService` の実装（透過ロジック）
  3. `shouldRouteToOpenAI` の実装（ルーティング判定）
  4. `proxy-router.ts` の拡張（分岐ロジック）
  5. 統合テスト（両経路）+ 回帰テスト（Antigravity）

- **総工数見積もり**: **4-5 days** (5-8 story points)

## 6. Recommendations for Design Phase
- **推奨アプローチ**: Option B（新規 `OpenAIPassthroughService`）を主軸に設計。
- **追加調査が必要な事項**:
  - `ChatCompletionRequestSchema` の適用範囲を Antigravity 経路と OpenAI 経路で分離する設計（パススルー時は厳格検証を回避するか最小検証に留める）。
  - 上流レスポンスの **ステータス/ヘッダー/ボディをそのまま**返すための `Response` 透過ロジックと、ストリーミング時のハンドリング。
  - `OPENAI_API_KEY` 未設定時の Auth Passthrough と、`OPENAI_BASE_URL` のデフォルト値処理の責務分解。
  - `model` 欠落時の OpenAI 互換エラーを明示的に生成する分岐の位置（ルーターかサービスか）。
