# Research & Design Decisions: codex-cli-model-display

---
**Purpose**: 設定ベースのモデルリスト機能に関する調査結果と設計判断を記録する。

**Usage**:
- ディスカバリーフェーズでの調査活動と結果を記録する。
- `design.md` には詳細すぎる判断のトレードオフを文書化する。
- 将来の監査や再利用のための参照と証拠を提供する。
---

## Summary
- **Feature**: `codex-cli-model-display`
- **Discovery Scope**: Extension（既存システム拡張）
- **Key Findings**:
  - `/v1/models` は `src/proxy/proxy-router.ts` に `FIXED_MODEL_IDS` として固定実装されている
  - アプリ組み立ては `src/main.ts` の DI パターンに集約されているため、モデル設定は起動時に注入するのが整合的
  - 既存の環境変数パースとロギングの型は `src/config/antigravity.ts` と `src/logging.ts` に揃っており、新規依存は不要

## Research Log

### Extension Point Analysis
- **Context**: 既存の統合ポイントと変更範囲を特定する
- **Sources Consulted**: `src/proxy/proxy-router.ts`, `src/main.ts`, `src/config/antigravity.ts`, `src/logging.ts`
- **Findings**:
  - `createProxyApp` が `/v1/models` を直接構築している
  - 起動時の DI は `createAppContext` に集約され、テスト差し替え前提の構造になっている
  - `config` 配下に環境変数の読み取りパターンが存在する
- **Implications**:
  - `src/config/models.ts` を新設し、起動時にロードしたモデル設定を `createProxyApp` に注入する
  - `createAppContext` または `startApplication` の初期化フローを非同期対応にする必要がある

### Configuration Inputs
- **Context**: 環境変数と設定ファイルの形式・優先順位を確定する
- **Sources Consulted**: `requirements.md`, 既存の環境変数パース実装
- **Findings**:
  - 環境変数は JSON 配列 / カンマ区切りの両形式を許容する要件
  - 設定ファイルはプロジェクトルートまたは `.codex/` に配置する想定
  - 追加モデルにメタデータは不要（Non-Goals）
- **Implications**:
  - 解析順は `fixed -> file -> env` として重複時は env を優先
  - `custom-models.json` は `models: string[]` の最小スキーマで定義する

### Dependency Check
- **Context**: 新規依存の有無と互換性を確認する
- **Sources Consulted**: `package.json`, `.kiro/steering/tech.md`
- **Findings**:
  - 既存の Zod と Bun で要件を満たせる
  - 新規ライブラリ導入は不要
- **Implications**:
  - 依存追加やバージョン変更を伴わない設計とする

### Response Format Validation
- **Context**: `/v1/models` のレスポンス形式を維持する
- **Sources Consulted**: 既存実装, 要件
- **Findings**:
  - `object: "list"` と `data: { id, object, created, owned_by }[]` が現行形式
- **Implications**:
  - 追加モデルも同形式で統合する

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: ルーター直結 | `proxy-router.ts` に設定ロジックを直接追加 | 変更範囲が小さい | 責務混在、テストが難しい | 非推奨 |
| B: 設定モジュール + DI 注入 | `src/config/models.ts` でロードし `createProxyApp` に注入 | 既存 DI パターンと整合、テスト容易 | 起動フローが非同期化 | **推奨** |
| C: モジュールキャッシュ | 設定モジュールのグローバル状態を参照 | 実装が短い | 初期化順と暗黙依存が増える | 回避 |

## Design Decisions

### Decision: 設定モジュール + DI 注入の採用
- **Context**: モデル設定を既存アーキテクチャに統合する
- **Alternatives Considered**:
  1. Option A: ルーター直結
  2. Option B: 設定モジュール + DI 注入
  3. Option C: モジュールキャッシュ
- **Selected Approach**: Option B
- **Rationale**:
  - `structure.md` の DI パターンと整合する
  - テスト時にモデル設定を差し替えやすい
- **Trade-offs**:
  - メリット: 責務分離、保守性
  - デメリット: 起動フローの非同期化
- **Follow-up**: `startApplication` の非同期化影響をテストで確認

### Decision: 優先順位の明確化
- **Context**: 重複モデル ID の扱いが要件で明示されている
- **Alternatives Considered**:
  1. `env > file > fixed`
  2. `file > env > fixed`
- **Selected Approach**: `env > file > fixed`（`fixed -> file -> env` の順でマージ）
- **Rationale**:
  - 要件ガイダンスの優先順位に一致
- **Trade-offs**:
  - メリット: ユーザーの意図が反映される
  - デメリット: 優先順位の説明が必要
- **Follow-up**: README に優先順位を明記

### Decision: 設定ファイルの最小スキーマ
- **Context**: 追加メタデータは非要件
- **Alternatives Considered**:
  1. `models: string[]` のみ
  2. `models: { id, owned_by }[]` も許容
- **Selected Approach**: Option 1
- **Rationale**:
  - 非要件の拡張を避け、実装とドキュメントを簡素化
- **Trade-offs**:
  - メリット: シンプルで誤設定が少ない
  - デメリット: 将来拡張時にスキーマ変更が必要
- **Follow-up**: Non-Goals にメタデータ未対応を明記

## Risks & Mitigations
- **起動フローの非同期化に伴う初期化順の不整合** — `startApplication` でモデル設定をロードし、DI で一元化
- **無効な設定による起動失敗** — 例外は捕捉し、警告ログのみで継続
- **優先順位の誤解** — README に `env > file > fixed` を明示

## References
- `.kiro/steering/tech.md` — 技術スタック
- `.kiro/steering/structure.md` — DI と構成ルール
- `src/proxy/proxy-router.ts` — 既存の `/v1/models` 実装
- `src/main.ts` — 起動時の DI 構成
