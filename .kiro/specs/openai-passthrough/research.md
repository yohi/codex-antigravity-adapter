# Research & Design Decisions: OpenAI Passthrough

---
**Purpose**: OpenAI Passthrough ルーター機能のディスカバリーフェーズで得られた知見と設計判断を記録する。

**Usage**:
- ディスカバリーフェーズの調査結果とアウトカムを記録
- `design.md` には詳細すぎる設計判断のトレードオフを文書化
- 将来の監査や再利用のための参照・エビデンスを提供
---

## Summary
- **Feature**: `openai-passthrough`
- **Discovery Scope**: Extension（既存システムの拡張）
- **Key Findings**:
  1. Router レベルでの分岐が最もクリーンなアプローチ（`TransformService` の責務を維持）
  2. 既存の `proxy-router.ts` は DI パターンに従っており、`OpenAIService` の追加は自然に統合可能
  3. 既存のエラーハンドリングパターン (`Result<T, E>`) を活用しつつ、OpenAI パススルー固有のエラー処理も必要

## Research Log

### 既存アーキテクチャパターンの調査
- **Context**: 新しい OpenAI パススルー機能を既存の Antigravity アダプターにどのように統合するか判断するため
- **Sources Consulted**: 
  - `src/proxy/proxy-router.ts` - エントリーポイントとルーティング構造
  - `src/proxy/transform-service.ts` - Antigravity 変換サービスの設計パターン
  - `src/proxy/model-routing-service.ts` - エイリアス解決の参考実装
- **Findings**:
  - Hono フレームワークを使用した Express スタイルのルーティング
  - ファクトリー関数によるDI (`createProxyApp`, `createTransformService`)
  - `Result<T, E>` 型を用いた明示的なエラーハンドリング
  - ストリーミングは `ReadableStream` をそのまま返却するパターン
- **Implications**: 
  - 新しい `OpenAIService` も同じファクトリーパターンで実装すべき
  - `CreateProxyAppOptions` に `openaiService` を追加する設計が自然

### OpenAI API パススルー要件の分析
- **Context**: OpenAI 互換リクエスト/レスポンスの透過性要件を満たす実装方法
- **Sources Consulted**:
  - OpenAI API ドキュメント（Chat Completions API）
  - 既存の `ChatCompletionRequestSchema` (Zod スキーマ)
- **Findings**:
  - OpenAI API は SSE ストリーミングを `data: [DONE]` で終端
  - ヘッダー `Authorization: Bearer {key}` が必須
  - レスポンス形式は既に `schema.ts` で定義済み（再利用可能）
- **Implications**: 
  - リクエスト変換は不要（そのまま転送）
  - ストリーミング応答の透過中継が必要

### ルーティング判定ロジックの設計
- **Context**: `model` 名に基づくルート判定のベストプラクティス
- **Sources Consulted**:
  - 要件定義書 Requirement 2
  - gap-analysis.md の推奨設計
- **Findings**:
  - `gemini` または `claude` を含むモデル名 → Antigravity
  - それ以外 → OpenAI（デフォルト）
  - 大文字小文字を区別しない判定が望ましい
- **Implications**: 
  - シンプルな `shouldRouteToOpenAI(modelName: string): boolean` 関数で実装可能
  - `ModelRoutingService` で解決後の `model` フィールドを使用して判定

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| **A: TransformService 拡張** | TransformService 内で分岐 | Router 変更不要 | 責務が不明瞭、テスト困難 | 非推奨 |
| **B: Router レベル分岐** | proxy-router で分岐し、専用サービスを呼び出し | 責務明確、影響範囲限定 | Router のロジック増加 | **採用** |
| **C: 新規エンドポイント** | `/v1/openai/*` を別途追加 | 完全分離 | クライアント設定変更が必要 | 要件に反する |

## Design Decisions

### Decision: Router レベルでの分岐パターンを採用
- **Context**: OpenAI パススルーと Antigravity 変換の切り替えをどこで行うか
- **Alternatives Considered**:
  1. Option A: TransformService 内部での分岐
  2. Option B: proxy-router.ts での分岐（採用）
  3. Option C: 新規エンドポイントの追加
- **Selected Approach**: `proxy-router.ts` 内で `model` 名を検査し、`OpenAIService` または `TransformService` を呼び出す
- **Rationale**: 
  - 責務の分離を維持（TransformService = Antigravity専用）
  - 既存コードへの影響最小化
  - テスタビリティの向上
- **Trade-offs**: 
  - Router のロジックが若干増加
  - 新しいサービスオプションの追加が必要
- **Follow-up**: E2E テストで両方のルートが正しく機能することを検証

### Decision: OPENAI_API_KEY の環境変数管理
- **Context**: OpenAI への認証情報をどのように管理するか
- **Alternatives Considered**:
  1. 環境変数 (`OPENAI_API_KEY`)（採用）
  2. 設定ファイル
  3. リクエストごとのクライアント提供
- **Selected Approach**: 環境変数 `OPENAI_API_KEY` を起動時に読み込み、サービスに注入
- **Rationale**: 
  - 既存の設定パターンと整合性がある（`PORT`, `ANTIGRAVITY_ADDITIONAL_MODELS`）
  - セキュリティベストプラクティスに準拠
  - クライアント側の設定を増やさない（要件 1.3）
- **Trade-offs**: 動的なキー変更には再起動が必要
- **Follow-up**: 未設定時のエラーメッセージが明確であることを確認

### Decision: ストリーミング応答の透過中継
- **Context**: SSE ストリーミングをどのように処理するか
- **Alternatives Considered**:
  1. 透過中継（そのまま転送）（採用）
  2. 解析・再構築
- **Selected Approach**: OpenAI からの SSE ストリームを `ReadableStream.pipeTo` 等でそのまま中継
- **Rationale**: 
  - 最小限の遅延
  - 変換エラーのリスク排除
  - 要件 3.3 の「逐次中継」を満たす
- **Trade-offs**: ストリーム内容のログ記録やデバッグが困難になる可能性
- **Follow-up**: エラー発生時のストリーム中断処理を検討

## Risks & Mitigations
1. **OpenAI API の仕様変更** — ヘッダー処理を設定可能にして将来の変更に対応
2. **ネットワークタイムアウト** — 明示的なタイムアウト設定と 504 エラーレスポンスを実装
3. **クライアントからの Authorization ヘッダー** — 無視（上書き）することを明示的にドキュメント化

## References
- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat) — API 仕様の正式リファレンス
- Gap Analysis Document — 初期調査と推奨アプローチの記録
- Steering Documents (`tech.md`, `structure.md`) — プロジェクトの技術スタック・構造ガイドライン
