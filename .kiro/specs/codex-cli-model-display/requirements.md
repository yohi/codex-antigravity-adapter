# Requirements Document

## Project Description (Input)
codex-cli のモデル選択メニュー（/model）を改修し、Antigravity Adapter などの外部プロバイダーから動的にモデル一覧を取得・表示する機能を実装する。

### 詳細要件ドラフト（EARS形式）

以下の要件定義は **EARS (Easy Approach to Requirements Syntax)** に基づいています。

#### Functional Requirements

* **When** the model selection menu is accessed (`/model`), the system **shall** fetch available models from the configured model providers (e.g., Antigravity Adapter at `http://localhost:3000/v1/models`).
* **The system** **shall** merge the fetched dynamic models with the existing static presets.
* **If** a model provider is unreachable or returns an error, the system **shall** fail silently and exclude those models from the list without crashing.
* **The system** **shall** display all models returned by the provider (e.g., `gemini-3-*`, `claude-*`) in the selection menu.

#### Technical Constraints

* The system **must** be implemented using **Rust** (extending the existing `codex-rs` codebase).
* The system **must** reuse existing HTTP client dependencies (e.g., `reqwest` or `ureq`) to minimize new dependencies.
* All execution **must** occur within the **Devcontainer** environment.
* Host-side execution is strictly **prohibited**.

## Requirements

### Requirement 1: 外部プロバイダーからの動的モデル取得
**Objective:** As a CLIユーザー, I want /model を開いたときに外部プロバイダーからモデル一覧を取得できるようにしたい, so that 最新の提供モデルを選択できる。

#### Acceptance Criteria
1. When `/model` メニューが開かれる, the system shall 設定済みの外部プロバイダーエンドポイント（例: `http://localhost:3000/v1/models`）からモデル一覧を取得する。
2. When 複数の外部プロバイダーが設定されている, the system shall 各プロバイダーのモデル一覧を取得して統合対象にする。

### Requirement 2: モデル一覧の統合と表示
**Objective:** As a CLIユーザー, I want 動的モデルと静的プリセットが統合されて表示されるようにしたい, so that 一つの一覧で候補を確認できる。

#### Acceptance Criteria
1. When 動的モデルの取得が完了している, the system shall 既存の静的プリセットと取得した動的モデルを統合してユーザーに提示する。
2. When 外部プロバイダーが有効なモデル一覧を返す, the system shall 返却されたすべてのモデル（例: `gemini-3-*`, `claude-*`）を省略せずに表示する。
3. While モデル一覧を表示している, the system shall 取得済みの動的モデルを静的プリセットと同様に選択可能な形式で表示する。

### Requirement 3: 堅牢なエラーハンドリング
**Objective:** As a CLIユーザー, I want 外部プロバイダー障害時も /model が安全に動作してほしい, so that 操作中にツールがクラッシュしたり応答不能になったりしない。

#### Acceptance Criteria
1. If 外部プロバイダーが到達不能である, the system shall サイレントに失敗し、そのプロバイダーのモデルを一覧から除外して動作を継続する。
2. If 外部プロバイダーがエラー応答（5xx等）を返す, the system shall クラッシュせずにサイレントに失敗し、そのプロバイダーのモデルを一覧から除外する。
3. When 動的モデルが取得できなかった場合, the system shall 既存の静的プリセットのみを一覧として提供し、ユーザーに異常を感じさせない。
