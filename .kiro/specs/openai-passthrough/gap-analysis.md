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
- **Effort**: **M**  
  - ルーター分岐、パススルー実装、ヘッダー制御、エラーフォーマット、ストリーミング透過で工数増。
- **Risk**: **Medium**  
  - 既存の Zod 検証ロジックがパススルー要件と衝突する可能性があり、ルーター改修の影響範囲が広い。

## 6. Recommendations for Design Phase
- **推奨アプローチ**: Option B（新規 `OpenAIPassthroughService`）を主軸に設計。
- **追加調査が必要な事項**:
  - `ChatCompletionRequestSchema` の適用範囲を Antigravity 経路と OpenAI 経路で分離する設計（パススルー時は厳格検証を回避するか最小検証に留める）。
  - 上流レスポンスの **ステータス/ヘッダー/ボディをそのまま**返すための `Response` 透過ロジックと、ストリーミング時のハンドリング。
  - `OPENAI_API_KEY` 未設定時の Auth Passthrough と、`OPENAI_BASE_URL` のデフォルト値処理の責務分解。
  - `model` 欠落時の OpenAI 互換エラーを明示的に生成する分岐の位置（ルーターかサービスか）。
