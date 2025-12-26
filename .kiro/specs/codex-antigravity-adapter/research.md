# Research & Design Decisions

## Summary
- **Feature**: `codex-antigravity-adapter`
- **Discovery Scope**: New Feature (Greenfield)
- **Key Findings**:
  - Google Antigravity API は内部 IDE 向け API であり、公開ドキュメントが限られている。`cloudcode-pa.googleapis.com` エンドポイントを使用
  - OpenAI Chat Completions API と Gemini API のスキーマ変換が必要（`messages` ↔ `contents`）
  - Codex CLI は `model_providers` を通じて OpenAI 互換のカスタムプロバイダーをサポート
  - Hono + Bun の組み合わせで SSE ストリーミング対応の軽量プロキシを構築可能

## Research Log

### Google Antigravity API の仕様調査
- **Context**: Antigravity API のエンドポイント構造と認証方式を理解する必要がある
- **Sources Consulted**: 
  - Web検索結果（Google Cloud Code Assist API ドキュメント）
  - spec.md（opencode-antigravity-auth からの移植仕様）
- **Findings**:
  - Antigravity API は `cloudcode-pa.googleapis.com` または `daily-cloudcode-pa.sandbox.googleapis.com` をエンドポイントとして使用
  - OAuth 2.0 認証フローを使用し、ポート 51121 でコールバックを受け取る
  - `X-Goog-Api-Client` や `Client-Metadata` などの特殊ヘッダーが必要
  - Claude モデル使用時は Thinking ブロックの署名処理に特別な対応が必要
- **Implications**: 
  - 標準的な Gemini API クライアントは使用不可、カスタム実装が必須
  - トークン管理とリフレッシュ機構の実装が必要

### OpenAI Chat Completions API 互換性
- **Context**: Codex CLI が期待する API フォーマットを正確に把握する
- **Sources Consulted**:
  - OpenAI Platform API Reference
  - Context7 ドキュメント
- **Findings**:
  - リクエスト: `POST /v1/chat/completions` with `messages` 配列, `model`, `stream` など
  - レスポンス: `id`, `choices[].message.content`, `usage` を含む JSON（ストリーミング時は SSE）
  - ストリーミング: `data: {...}\n\n` 形式の SSE チャンク、終端は `data: [DONE]`
- **Implications**:
  - OpenAI → Gemini スキーマ変換（`messages` → `contents`）の実装が必要
  - SSE ストリーミングのプロキシ処理が必要

### Gemini API リクエスト/レスポンス形式
- **Context**: Antigravity API は Gemini 形式のスキーマを使用
- **Sources Consulted**:
  - Google Gemini API ドキュメント
  - Web検索結果
- **Findings**:
  - リクエスト: `contents[].parts[].text` 形式、`role` は `user`/`model`
  - `generateContent` / `streamGenerateContent` エンドポイント
  - レスポンス: `candidates[].content.parts[].text` 形式
- **Implications**:
  - 双方向のスキーマ変換ロジックを `request.ts` / `response.ts` として実装

### Codex CLI プロバイダー設定
- **Context**: Codex CLI がカスタムプロバイダーをどのように扱うかを確認
- **Sources Consulted**:
  - Codex CLI GitHub Repository / Context7 ドキュメント
- **Findings**:
  - `~/.codex/config.toml` の `[model_providers.<name>]` セクションで定義
  - 必須フィールド: `name`, `base_url`, `wire_api`
  - `wire_api = "chat"` で OpenAI Chat Completions 互換モード
  - `env_key` でダミー API キーを設定可能（プロキシ側で認証するため）
- **Implications**:
  - ユーザードキュメントに `config.toml` 設定例を含める必要がある

### ローカルプロキシ技術スタック
- **Context**: 軽量で高速なプロキシサーバーの技術選定
- **Sources Consulted**:
  - Hono フレームワークドキュメント / Context7
  - Bun ランタイムドキュメント
- **Findings**:
  - Hono: Web Standards ベースの超軽量フレームワーク、SSE ネイティブサポート
  - `streamSSE` ヘルパーで簡単に SSE エンドポイント実装可能
  - Bun: 高速な JavaScript ランタイム、TypeScript ネイティブサポート
  - `Bun.serve` で大きなリクエストボディ設定可能
- **Implications**:
  - Hono + Bun の組み合わせで高性能プロキシを実現

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Hexagonal (Ports & Adapters) | コアドメインをポート経由で外部と疎結合 | テスタビリティ高、変換ロジック分離 | 小規模プロジェクトにはオーバーヘッド | 推奨: 変換層の独立性を確保 |
| Simple Layered | ルーター → ハンドラー → サービス層 | シンプル、学習コスト低 | 変換ロジックの膨らみ | 代替案 |
| Middleware Chain | Express/Hono ミドルウェアパターン | リクエスト処理の可視化 | 状態管理が複雑化 | 認証フローには適用 |

**選択**: Hexagonal パターンベース（簡略化版）
- ポート: `AuthPort`, `ProxyPort`
- アダプター: `OAuthAdapter`, `AntigravityAdapter`, `OpenAICompatibleAdapter`

## Design Decisions

### Decision: トークン永続化方式
- **Context**: OAuth トークンをセッション間で維持する必要がある
- **Alternatives Considered**:
  1. JSON ファイル（`~/.codex/antigravity-tokens.json`）— シンプル、既存ツール互換
  2. SQLite — 構造化クエリ、複数アカウント対応
  3. Keychain/Credential Manager — OS ネイティブの安全なストレージ
- **Selected Approach**: JSON ファイル方式
- **Rationale**: opencode-antigravity-auth との互換性維持、シンプルな実装、ファイルシステムアクセスのみ
- **Trade-offs**: セキュリティは OS ファイルパーミッションに依存、マルチアカウント機能は手動対応
- **Follow-up**: ファイルパーミッション設定（600）の実装確認

### Decision: サーバーポート分離
- **Context**: 認証フローと API プロキシを分離する必要がある
- **Alternatives Considered**:
  1. 単一ポート（パスベースルーティング）— シンプル
  2. 2ポート分離（OAuth: 51121, API: 3000）— opencode 互換、関心分離
- **Selected Approach**: 2ポート分離
- **Rationale**: opencode-antigravity-auth の仕様準拠、OAuth コールバック URL の固定要件
- **Trade-offs**: 2つのプロセス/リスナー管理が必要
- **Follow-up**: シングルプロセスで複数ポートリッスン可能か確認

### Decision: SSE ストリーム変換方式
- **Context**: Antigravity SSE → OpenAI SSE の変換が必要
- **Alternatives Considered**:
  1. バッファリング後一括変換 — 実装シンプル、レイテンシ増
  2. ストリーミング逐次変換 — 低レイテンシ、実装複雑
- **Selected Approach**: ストリーミング逐次変換
- **Rationale**: インタラクティブな CLI 体験には低レイテンシが必須
- **Trade-offs**: エラー処理が複雑化、部分的なチャンク処理ロジックが必要
- **Follow-up**: Hono の `streamSSE` でのパイプ処理実装例確認

## Risks & Mitigations
- **Risk 1**: Antigravity API の非公開仕様変更 — 定期的な動作確認テスト、エラーハンドリング強化
- **Risk 2**: Claude Thinking ブロック署名エラー — opencode-antigravity-auth の対策ロジック移植（Thinking ブロック削除）
- **Risk 3**: トークン有効期限切れ時のユーザビリティ — 自動リフレッシュ機構、明確なエラーメッセージと再認証ガイド

## References
- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) — リクエスト/レスポンス仕様
- [Codex CLI Configuration](https://github.com/openai/codex/blob/main/docs/config.md) — プロバイダー設定例
- [Hono SSE Helper](https://hono.dev/docs/helpers/streaming#streaming-helper) — streamSSE 実装例
- [Gemini API generateContent](https://ai.google.dev/gemini-api/docs/text-generation) — Gemini リクエスト形式
