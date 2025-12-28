# Requirements: github-actions-ci-pipelines

## Project Description

GitHub Actions を導入し、Pull Request 作成時および main ブランチへの Push 時に、ユニットテスト・ビルド・型チェック・Lint を自動実行する CI パイプラインを構築する。

## Introduction

この仕様は、`codex-antigravity-adapter` リポジトリにおいて、変更の品質を継続的に検証するための GitHub Actions ベースの CI パイプライン要件を定義する。  
CI は Pull Request と `main` ブランチへの Push を契機に、ユニットテスト・ビルド・型チェック・Lint を自動で実行し、結果を GitHub 上で判別可能な形で報告する。

## Requirements

### Requirement 1: ワークフローの起動条件と対象
**Objective:** As a リポジトリ利用者, I want 変更時にCIが自動起動する, so that 早期に品質問題を検知できる

#### Acceptance Criteria
1. When Pull Request が作成または更新されたとき, the GitHub Actions CI shall CI を自動で開始する
2. When `main` ブランチに Push されたとき, the GitHub Actions CI shall CI を自動で開始する
3. When CI が開始されたとき, the GitHub Actions CI shall 実行対象のコミット SHA と対象イベント（PR もしくは Push）を実行ログから識別できるようにする

### Requirement 2: CI で実行する品質チェック
**Objective:** As a リポジトリ利用者, I want 変更の品質チェックが一貫して実行される, so that 手元環境差による見落としを減らせる

#### Acceptance Criteria
1. When CI が開始されたとき, the GitHub Actions CI shall ユニットテストを実行する
2. When CI が開始されたとき, the GitHub Actions CI shall ビルドを実行する
3. When CI が開始されたとき, the GitHub Actions CI shall TypeScript の型チェックを実行する
4. When CI が開始されたとき, the GitHub Actions CI shall Lint を実行する
5. If いずれかの品質チェックが失敗したとき, then the GitHub Actions CI shall 当該ワークフロー実行を失敗として終了させる

### Requirement 3: 実行環境の整合性と再現性
**Objective:** As a リポジトリ利用者, I want CI と開発環境の前提が揃う, so that CI 結果を信頼できる

#### Acceptance Criteria
1. When CI が開始されたとき, the GitHub Actions CI shall リポジトリが要求する Bun 実行環境（`engines.bun` の制約に適合）で実行する
2. When CI が開始されたとき, the GitHub Actions CI shall 依存関係の解決がリポジトリのロックファイルに基づいて再現可能であることを保証する
3. If 依存関係の解決が再現できない状態になったとき, then the GitHub Actions CI shall その理由がログから特定できるように失敗として報告する

### Requirement 4: 結果の可視性とフィードバック
**Objective:** As a Pull Request 作成者, I want CI 結果が分かりやすく表示される, so that 修正判断を迅速に行える

#### Acceptance Criteria
1. When CI が実行されたとき, the GitHub Actions CI shall GitHub の Checks 上で「ユニットテスト」「ビルド」「型チェック」「Lint」の成否が識別可能である
2. If 品質チェックが失敗したとき, then the GitHub Actions CI shall 失敗したチェック種別と失敗箇所の手がかりを GitHub 上で確認できるようにする
3. When CI が成功したとき, the GitHub Actions CI shall 実行が成功したことを GitHub 上で明確に示す

### Requirement 5: 冪等性と無駄な実行の抑制
**Objective:** As a リポジトリ利用者, I want 変更の反復に対してCIが効率よく動作する, so that フィードバック待ち時間を減らせる

#### Acceptance Criteria
1. When 同一 Pull Request に対して新しいコミットが Push されたとき, the GitHub Actions CI shall 当該 Pull Request の旧コミットに対する未完了の実行をキャンセルする
2. The GitHub Actions CI shall 同一 Pull Request ごとに同時に実行中のワークフローを 1 件に制限する

### Requirement 6: セキュリティと権限の最小化
**Objective:** As a リポジトリ管理者, I want CI の権限と情報露出を最小化する, so that 供給連鎖リスクを低減できる

#### Acceptance Criteria
1. The GitHub Actions CI shall CI 実行に必要な範囲に限定した最小権限で動作する
2. The GitHub Actions CI shall ワークフローのログに機密情報（トークン、シークレット、個人情報等）を出力しない
3. When Pull Request が外部コントリビュータ由来であるとき, the GitHub Actions CI shall 不要な書き込み権限や機密情報を前提とせずに実行できる

---

**Initialized**: 2025-12-29T00:43:21+09:00  
**Updated**: 2025-12-29T00:50:31+09:00
