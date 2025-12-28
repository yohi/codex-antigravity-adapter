# Research & Design Decisions: codex-cli-model-display

---
**Purpose**: 設定ベースのモデルリスト機能を実装するための調査結果と設計判断を記録する。

**Usage**:
- ディスカバリーフェーズでの調査活動と結果を記録。
- `design.md` には詳細すぎる設計判断のトレードオフを文書化。
- 将来の監査や再利用のための参照と証拠を提供。
---

## Summary
- **Feature**: `codex-cli-model-display`
- **Discovery Scope**: Extension（既存システムの拡張）
- **Key Findings**:
  1. Google Antigravity API にはモデル一覧取得エンドポイントが存在しないことが確認済み（事前調査済み）
  2. 既存のモデルリストは `proxy-router.ts` 内に `FIXED_MODEL_IDS` として定数定義されている
  3. プロジェクトは関心の分離パターンを既に採用しており、`src/config/` ディレクトリが設定ロジック用に存在する

## Research Log

### Antigravity API モデルエンドポイントの調査
- **Context**: 動的なモデルリスト取得の可能性を調査
- **Sources Consulted**: Gap Analysis (`gap-analysis.md`)、既存の API エンドポイント調査結果
- **Findings**:
  - Google Antigravity (Cloud Code Assist) API にはモデル一覧を返すエンドポイントが存在しない
  - API ドキュメントでは `/v1internal:loadCodeAssist` のような completion 系エンドポイントのみ確認
  - 外部からモデル情報を取得する標準的な方法がない
- **Implications**: 
  - 動的なモデルリスト取得は実現不可能
  - ユーザー主導の設定ベースアプローチが最適解

### 既存コードベースのパターン分析
- **Context**: 新しいモデル設定モジュールが既存パターンに適合するよう調査
- **Sources Consulted**: `src/proxy/proxy-router.ts`, `src/config/antigravity.ts`, `.kiro/steering/`
- **Findings**:
  - `src/config/antigravity.ts` で環境変数から設定値を読み込むパターンが確立済み
  - `process.env.VARIABLE ?? デフォルト値` の形式で環境変数をパース
  - カンマ区切りの配列→ `split(",").map(s => s.trim())` パターン（`ANTIGRAVITY_SCOPES` で使用）
  - `Logger` インターフェースが `src/logging.ts` で定義済み
  - ファクトリ関数パターン（`createLogger`, `createProxyApp`）が標準
- **Implications**: 
  - `src/config/models.ts` を新設し、既存パターンに従った実装が可能
  - 環境変数パースは既存パターンを流用可能
  - ロギングは `Logger` インターフェースを使用

### Bun ファイルシステム API の調査
- **Context**: 設定ファイルの読み込みに使用する API を確認
- **Sources Consulted**: Bun 公式ドキュメント、`tech.md`
- **Findings**:
  - `Bun.file(path).text()` で非同期ファイル読み込みが可能
  - `Bun.file(path).exists()` でファイル存在チェック（Bun 1.0.25+）
  - `await Bun.file(path).json()` で JSON パースも一行で可能
  - 存在しないファイルの場合は適切なエラーハンドリングが必要
- **Implications**: 
  - 起動時のファイル読み込みに `Bun.file()` API を使用
  - ファイル不在時は警告ログを出力し、空配列として処理

### OpenAI Models API レスポンス形式の確認
- **Context**: `/v1/models` レスポンスが OpenAI 互換であることを確認
- **Sources Consulted**: OpenAI API ドキュメント, 既存実装
- **Findings**:
  - 既存実装は正しく OpenAI 形式に準拠: `{ object: "list", data: [...] }`
  - 各モデルオブジェクト: `{ id, object: "model", created, owned_by }`
  - `owned_by` フィールドは必須（現在は `"antigravity"` 固定）
- **Implications**: 
  - レスポンス形式の変更は不要
  - 追加モデルも同じ形式で統合可能

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 既存ルーティング拡張 | `proxy-router.ts` 内に直接設定読み込みロジックを追加 | ファイル追加不要、変更箇所が局所的 | 責務の混在、テスト困難性、ファイル肥大化 | 非推奨 |
| B: 設定モジュール新設 | `src/config/models.ts` を作成し専用ロジックを集約 | 関心の分離、テスト容易性、拡張性 | ファイル数増加（1ファイル） | **推奨** |

## Design Decisions

### Decision: 設定モジュール新設アプローチの採用
- **Context**: モデルリストの設定可能化を実装する際のアーキテクチャ選択
- **Alternatives Considered**:
  1. Option A: `proxy-router.ts` 内への直接実装
  2. Option B: `src/config/models.ts` 新設
- **Selected Approach**: Option B - 設定モジュール新設
- **Rationale**: 
  - プロジェクトの既存パターン（関心の分離、ファクトリ関数）に適合
  - `src/config/` ディレクトリが既に設定用途として確立
  - ルーターは「ルーティング」、設定モジュールは「設定管理」と責務が明確
- **Trade-offs**: 
  - メリット: テスト容易性、保守性、将来の拡張性
  - デメリット: ファイル数が1増加（許容範囲）
- **Follow-up**: 統合テストで `/v1/models` レスポンスを検証

### Decision: 環境変数形式の設計
- **Context**: `ANTIGRAVITY_ADDITIONAL_MODELS` 環境変数の形式を決定
- **Alternatives Considered**:
  1. カンマ区切り形式のみ: `model1,model2,model3`
  2. JSON 配列形式のみ: `["model1","model2"]`
  3. 両形式サポート（ハイブリッド）
- **Selected Approach**: 両形式サポート（ハイブリッド）
- **Rationale**: 
  - カンマ区切りはシンプルで一般的（シェルからの設定が容易）
  - JSON 配列は将来的にメタデータ拡張時に有用
  - 既存パターン（`ANTIGRAVITY_SCOPES`）がカンマ区切りを使用
- **Trade-offs**: 
  - メリット: ユーザーの柔軟性向上
  - デメリット: パース処理が若干複雑化
- **Follow-up**: ドキュメントで両形式を説明

### Decision: 設定ファイル探索パスの戦略
- **Context**: `custom-models.json` の探索場所を決定
- **Alternatives Considered**:
  1. カレントディレクトリ（`process.cwd()`）のみ
  2. `.codex/` サブディレクトリのみ
  3. 複数パスの順序探索
- **Selected Approach**: 複数パスの順序探索（カレント → `.codex/`）
- **Rationale**: 
  - ユーザーがプロジェクトルートに配置する一般的なパターンをサポート
  - `.codex/` ディレクトリは Codex 関連設定の標準的な場所
  - 先に見つかった方を使用し、競合を回避
- **Trade-offs**: 
  - メリット: 柔軟な配置オプション
  - デメリット: どちらが優先されるかの明確なドキュメントが必要
- **Follow-up**: README でパス優先順位を明記

### Decision: エラーハンドリング戦略 - Graceful Degradation
- **Context**: 設定エラー時の動作方針を決定
- **Alternatives Considered**:
  1. エラー時に起動失敗（Fail Fast）
  2. エラー時に警告ログを出力し継続（Graceful Degradation）
- **Selected Approach**: Graceful Degradation
- **Rationale**: 
  - 設定ファイルは任意機能であり、その欠如でコア機能を停止すべきでない
  - 警告ログにより問題を可視化しつつ運用継続可能
  - 要件に明記された方針に適合
- **Trade-offs**: 
  - メリット: システム可用性の維持
  - デメリット: 設定ミスに気づきにくい可能性
- **Follow-up**: 起動時ログに設定状況（読み込んだモデル数）を明示

## Risks & Mitigations
- **設定ファイルの無限再読み込み** — 起動時の一回限りの読み込みとし、ホットリロードは初期スコープ外
- **JSON パースエラーによるクラッシュ** — try-catch で捕捉し、警告ログ出力後に空配列として処理
- **セキュリティリスク（任意パスからのファイル読み込み）** — 固定パスのみを探索し、ユーザー指定パスは初期スコープ外

## References
- [Bun File I/O](https://bun.sh/docs/api/file-io) — Bun のファイル読み込み API
- [OpenAI Models API](https://platform.openai.com/docs/api-reference/models) — レスポンス形式の参照
- `.kiro/steering/tech.md` — プロジェクト技術スタック
- `.kiro/steering/structure.md` — コードベース構造ガイドライン
