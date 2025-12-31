# 調査・設計判断ログ

---
**Purpose**: 設計に影響する発見事項と判断理由を記録する。
---

## Summary
- **Feature**: dynamic-model-routing
- **Discovery Scope**: Extension
- **Key Findings**:
  - ルーティングは `src/proxy/proxy-router.ts` のスキーマ検証後が既存パターンの拡張ポイント
  - 設定ファイルのパス安全性は `src/config/model-settings-service.ts` の `isUnsafePath` を再利用可能
  - 既存スタック（Bun/Hono/Zod）で完結し、新規依存は不要

## Research Log

### 既存のリクエスト処理パイプライン
- **Context**: ルーティング挿入位置の特定
- **Sources Consulted**: `src/proxy/proxy-router.ts`, `src/proxy/transform-service.ts`, `src/transformer/schema.ts`
- **Findings**:
  - `ChatCompletionRequestSchema.safeParse` 後に `transformService.handleCompletion` を呼び出す構造
  - `UserContentSchema` が配列を文字列に変換済みのため、ルーティングは検証後に適用可能
- **Implications**: ルーティングはスキーマ検証後の `parsed.data` に対して実行する

### 設定ファイル読み込みパターン
- **Context**: `model-aliases.json` 読み込みの安全性とログ方針
- **Sources Consulted**: `src/config/model-settings-service.ts`
- **Findings**:
  - `isUnsafePath` により相対パスのみ許容するガードが存在
  - `Bun.file(...).exists()` と JSON パースのエラーログが一貫している
- **Implications**: エイリアス設定の読み込みでも同様のガードとログ方針を踏襲する

### ロギング方針
- **Context**: ルーティング時ログ要件への対応
- **Sources Consulted**: `src/logging.ts`
- **Findings**:
  - `Logger` は `debug/info/warn/error` の4種で統一
  - `NOOP_LOGGER` が存在し、依存注入で無効化可能
- **Implications**: ルーティング適用時は `debug` を必須出力とし、既存 Logger を注入する

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Proxy 内サービス追加 | `proxy-router` にルーティングサービスを挿入 | 既存パターンに沿う、変更範囲が局所的 | Proxy の責務増加 | 採用方針 |
| Transformer 変更 | 変換層でルーティング処理 | 1箇所に集約 | 既存変換責務を汚染 | 不採用 |
| スキーマ変更 | `ChatCompletionRequestSchema` で処理 | 変換前に扱える | 要件 6.4 に反する | 不採用 |

## Design Decisions

### Decision: ルーティング挿入位置はスキーマ検証後
- **Context**: 要件 2.4, 6.4 を満たしつつ既存変換と整合させる必要がある
- **Alternatives Considered**:
  1. 変換前（生 JSON）での処理
  2. Transformer 内での処理
- **Selected Approach**: `ChatCompletionRequestSchema.safeParse` 後に `ModelRoutingService` を適用
- **Rationale**: 既存の文字列化ロジックを保持し、境界を崩さない
- **Trade-offs**: 配列の生構造にはアクセスできない
- **Follow-up**: 変換前処理が必要になった場合はスコープ拡張が必要

### Decision: エイリアス設定は起動時に1回読み込み
- **Context**: 要件 1.1 とパフォーマンスの両立
- **Alternatives Considered**:
  1. リクエストごとの読み込み
  2. ファイル監視によるホットリロード
- **Selected Approach**: 起動時ロード + 変更は再起動で反映
- **Rationale**: 低オーバーヘッドで安定運用が可能
- **Trade-offs**: 変更反映に再起動が必要
- **Follow-up**: 運用要件が高まれば再読み込み API を検討

### Decision: エイリアス検出は先頭一致かつ空白/終端条件を必須化
- **Context**: 誤検出と誤ルーティングを避ける必要がある
- **Alternatives Considered**:
  1. 先頭の `@` パターンだけで検出
  2. 空白/終端判定を追加
- **Selected Approach**: 先頭一致 + 空白または終端でのみ検出
- **Rationale**: `@fastest` のような誤検出を防ぐ
- **Trade-offs**: 連結文字列での短縮入力は不可
- **Follow-up**: 需要があればデリミタ拡張を検討

## Risks & Mitigations
- 設定ファイルのパスが安全性チェックで無効化される — `isUnsafePath` の適用順序を明確化し相対パスのみ許容
- エイリアス設定変更が即時反映されない — 再起動運用を明記し、将来のリロード検討を残す
- ルーティング適用ログの欠落 — `ModelRoutingService` 内で必須 `debug` ログを出力

## References
- `src/proxy/proxy-router.ts` — ルーティング統合ポイント
- `src/transformer/schema.ts` — ユーザーメッセージ文字列化
- `src/config/model-settings-service.ts` — パス安全性と設定読み込み
- `.kiro/settings/rules/design-principles.md` — 設計ルール
