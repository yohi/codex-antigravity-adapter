# Research & Design Decisions: github-actions-ci-pipelines

---
**Purpose**: CI パイプライン実装に必要な調査結果とアーキテクチャ決定を記録する。

---

## Summary
- **Feature**: `github-actions-ci-pipelines`
- **Discovery Scope**: Extension（既存プロジェクトへの CI 導入）
- **Key Findings**:
  - `oven-sh/setup-bun@v2` は `package.json` の version-file 読み取りに対応
  - Biome は Bun/TypeScript プロジェクトに最適な高速リンター
  - GitHub Actions `concurrency` + `cancel-in-progress` で重複実行を抑制可能

## Research Log

### oven-sh/setup-bun Action
- **Context**: Bun 実行環境を GitHub Actions で再現する方法の調査
- **Sources Consulted**: [oven-sh/setup-bun README](https://github.com/oven-sh/setup-bun)
- **Findings**:
  - `bun-version-file: "package.json"` を指定すると `engines.bun` のバージョン制約を自動取得
  - キャッシュ対応により `bun install` を高速化
  - 出力: `bun-version`, `cache-hit` などでデバッグ可能
- **Implications**: Req 3.1（Bun 実行環境）の達成手段として採用

### リンター選定: Biome vs ESLint
- **Context**: Req 2.4（Lint 実行）に必要なツール選定
- **Sources Consulted**: biomejs.dev, `tech.md` steering doc, Bun ベストプラクティス記事
- **Findings**:
  - Biome: Rust 製で高速、Lint + Format を単一ツールで提供、CI 実行時間短縮に貢献
  - ESLint + Prettier: 従来実績あり、`tech.md` に「Prettier (or standard JS formatting)」と記載
  - `tech.md` の記述は Biome を排除しない（"or standard JS formatting" の余地）
- **Decision**: **Biome を採用**（高速・簡潔・Bun エコシステムとの親和性）
- **Implications**: `@biomejs/biome` を devDependencies に追加、`biome.json` を作成

### GitHub Actions concurrency 設定
- **Context**: Req 5.1（旧コミットのキャンセル）、Req 5.2（同時実行制限）
- **Sources Consulted**: GitHub Docs, ベストプラクティス記事
- **Findings**:
  - `concurrency.group` でグループ名を定義（例: `ci-${{ github.ref }}`）
  - `cancel-in-progress: true` で同一グループの既存実行をキャンセル
  - PR 毎に同時実行を 1 件に制限できる
- **Implications**: ワークフローレベルで `concurrency` ブロックを設定

### 権限最小化
- **Context**: Req 6.1（最小権限）、Req 6.2（機密情報非露出）
- **Sources Consulted**: GitHub Docs on permissions
- **Findings**:
  - `permissions: contents: read` で読み取り専用に制限
  - `pull_request` イベントは fork からでも安全に実行可能
- **Implications**: ワークフロー先頭で `permissions` を明示

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 単一ワークフロー | 1 ファイルで全ジョブを定義 | シンプル、保守しやすい | ジョブ増加時に肥大化 | 現時点では十分 |
| 複数ワークフロー | lint/test/build を分割 | 粒度細かい制御 | ファイル管理複雑化 | 将来オプション |

**Decision**: 単一ワークフロー（`ci.yml`）を採用。ジョブ内で並列ステップは不要（依存順序ないため jobs を並列化可能）。

## Design Decisions

### Decision: Biome 採用
- **Context**: Lint + Format ツール選定
- **Alternatives Considered**:
  1. ESLint + Prettier
  2. Biome
- **Selected Approach**: Biome
- **Rationale**: Bun エコシステムとの親和性、CI 高速化
- **Trade-offs**: Prettier エコシステムとの直接互換はなし（Biome 独自フォーマット）
- **Follow-up**: 既存コードの Lint エラーを `biome check --write` で自動修正後にコミット

### Decision: 単一ワークフローファイル
- **Context**: ci.yml の構成
- **Selected Approach**: `.github/workflows/ci.yml` にすべてのジョブを記述
- **Rationale**: プロジェクト規模が小さく、複数ファイル分割は過剰
- **Trade-offs**: 将来的な拡張時にはファイル分割を検討

## Risks & Mitigations
- **Risk 1**: 既存コードが Biome ルールに違反 → 初回実行時に `biome check --write` で自動修正
- **Risk 2**: `bun install --frozen-lockfile` 失敗（lockfile 未更新） → CI ログで原因特定可能（Req 3.3）
- **Risk 3**: 外部 Action のセキュリティ → 公式 Action（`actions/checkout`, `oven-sh/setup-bun`）のみ使用、ピン留めバージョン

## References
- [oven-sh/setup-bun GitHub](https://github.com/oven-sh/setup-bun) — Bun セットアップ Action
- [Biome 公式](https://biomejs.dev/) — Linter/Formatter ドキュメント
- [GitHub Actions: concurrency](https://docs.github.com/en/actions/using-jobs/using-concurrency) — 同時実行制御
