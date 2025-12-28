# Implementation Plan: github-actions-ci-pipelines

## Task Breakdown

- [ ] 1. Biome の導入と Lint 環境のセットアップ
- [x] 1.1 (P) Biome を devDependencies に追加
  - `@biomejs/biome@latest` をインストール
  - `bun.lockb` を更新して依存関係を固定
  - _Requirements: 2.4_

- [ ] 1.2 (P) Biome 設定ファイルを作成
  - `biome.json` を作成し、`src/` と `tests/` を対象に設定
  - TypeScript プロジェクト向けのルールを適用
  - formatter と linter を有効化
  - _Requirements: 2.4_

- [ ] 1.3 (P) package.json に lint スクリプトを追加
  - `"lint": "biome check src tests"` を scripts に追加
  - ローカル環境で `bun run lint` が実行可能であることを確認
  - _Requirements: 2.4_

- [ ] 2. TypeScript 型チェックのセットアップ
- [ ] 2.1 (P) package.json に型チェックスクリプトを追加
  - `"check-types": "tsc --noEmit"` を scripts に追加
  - ローカル環境で `bun run check-types` が実行可能であることを確認
  - 既存コードが型エラーなしで通過することを検証
  - _Requirements: 2.3_

- [ ] 3. GitHub Actions ワークフロー定義の作成
- [ ] 3.1 CI ワークフロー基本構造を作成
  - `.github/workflows/ci.yml` を作成
  - `pull_request` と `master` ブランチへの `push` をトリガーに設定
  - `ubuntu-slim` ランナーを指定（1 vCPU, 5GB RAM, 15分制限）
  - `permissions: contents: read` で最小権限を設定
  - _Requirements: 1.1, 1.2, 6.1_

- [ ] 3.2 Concurrency 制御を設定
  - `concurrency.group` を `${{ github.workflow }}-${{ github.ref }}` に設定
  - `cancel-in-progress: true` で同一 PR の旧実行をキャンセル
  - 同一 PR ごとに 1 件のみ実行されることを保証
  - _Requirements: 5.1, 5.2_

- [ ] 3.3 共通セットアップステップを定義
  - `actions/checkout@v4` でリポジトリを取得
  - `oven-sh/setup-bun@v2` で Bun 環境をセットアップ
  - `bun-version-file: "package.json"` で engines.bun を参照
  - `cache: true` で依存関係キャッシュを有効化（15分制限対策）
  - `bun install --frozen-lockfile` で依存関係を再現可能にインストール
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 4. 並列ジョブの実装
- [ ] 4.1 (P) Lint ジョブを実装
  - `bun run lint` を実行
  - 違反があれば非ゼロ終了でジョブ失敗
  - GitHub Checks で結果を識別可能にする
  - _Requirements: 2.4, 2.5, 4.1, 4.2_

- [ ] 4.2 (P) 型チェックジョブを実装
  - `bun run check-types` を実行
  - 型エラーがあれば非ゼロ終了でジョブ失敗
  - GitHub Checks で結果を識別可能にする
  - _Requirements: 2.3, 2.5, 4.1, 4.2_

- [ ] 4.3 (P) ユニットテストジョブを実装
  - `bun run test` を実行
  - テスト失敗時は非ゼロ終了でジョブ失敗
  - GitHub Checks で結果を識別可能にする
  - _Requirements: 2.1, 2.5, 4.1, 4.2_

- [ ] 4.4 (P) ビルドジョブを実装
  - `bun run build` を実行
  - ビルドエラー時は非ゼロ終了でジョブ失敗
  - GitHub Checks で結果を識別可能にする
  - _Requirements: 2.2, 2.5, 4.1, 4.2_

- [ ] 5. CI の動作検証とフィードバック確認
- [ ] 5.1 テスト PR を作成して CI 動作を検証
  - ワークフロー追加後、実際の PR を作成
  - 全ジョブ（lint, type-check, test, build）が並列実行されることを確認
  - GitHub Checks で各ジョブの成否が識別可能であることを確認
  - コミット SHA とイベント種別がログから識別可能であることを確認
  - _Requirements: 1.3, 4.1, 4.3_

- [ ] 5.2 失敗シナリオをテスト
  - 意図的に Lint エラーを含むコミットで PR を作成し、失敗表示を確認
  - 意図的に型エラーを含むコミットで失敗を確認
  - 失敗箇所の手がかりが GitHub 上で確認できることを検証
  - _Requirements: 4.2_

- [ ] 5.3 Concurrency 動作を検証
  - 同一 PR に新しいコミットを Push し、旧実行がキャンセルされることを確認
  - 複数 PR で並列実行が可能であることを確認
  - _Requirements: 5.1, 5.2_

- [ ] 5.4 外部コントリビュータ PR の安全性を確認
  - Fork からの PR でも CI が実行可能であることを確認
  - 書き込み権限や機密情報を必要としないことを検証
  - ログに機密情報が出力されていないことを確認
  - _Requirements: 6.2, 6.3_

---

**Generated**: 2025-12-29T01:47:47+09:00
