# 実装計画: OpenAI Passthrough

## 概要

OpenAI Passthrough ルーターは、モデル名に基づいて Antigravity または上位サーバー（OpenAI API 等）にリクエストを自動で振り分ける機能を提供します。クライアントは単一のエンドポイント設定で複数のプロバイダーのモデルをシームレスに利用できます。

**新機能**:
- **Auth Passthrough モード**: `OPENAI_API_KEY` 未設定時、クライアントの `Authorization` ヘッダーを上位サーバーへ転送
- **カスタマイズ可能な接続先**: `OPENAI_BASE_URL` 環境変数で接続先を指定可能

---

## タスク

- [ ] 1. 設定サービスの実装
- [ ] 1.1 (P) OpenAI 設定管理機能の実装
  - 環境変数 `OPENAI_API_KEY` からキーを読み込む機能を実装
  - 環境変数 `OPENAI_BASE_URL` から接続先 URL を読み込む機能を実装（デフォルト: `https://api.openai.com`）
  - キーの存在チェック機能を提供 (`isConfigured()`)
  - Base URL の取得機能を提供 (`getBaseUrl()`)
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 2. OpenAI パススルーサービスの実装
- [ ] 2.1 (P) 上位サーバーとの通信基盤を構築
  - 上位サーバー API エンドポイントへのリクエスト送信機能を実装
  - 標準 `fetch` API を使用した HTTP クライアントロジックを実装
  - 接続先を `configService.getBaseUrl()` から取得
  - タイムアウト設定と信号制御を実装（デフォルト: 60000ms）
  - リクエストボディをスキーマ変換せずに転送する処理を実装（`JSON.stringify(body)` で再シリアライズ）
  - _Requirements: 3.1, 3.4_

- [ ] 2.2 (P) ヘッダー処理ロジックの実装（Auth Passthrough 対応）
  - **認証ヘッダーの条件分岐処理**:
    - `configService.getApiKey()` が設定されている場合: クライアントの `Authorization` ヘッダーを無視し、サーバー側 API キーで上書き
    - `configService.getApiKey()` が未設定の場合（Auth Passthrough モード）: クライアントの `Authorization` ヘッダーをそのまま転送
  - `Host` と `Content-Length` ヘッダーを除外する処理を実装
  - その他のクライアントヘッダーを保持して転送する処理を実装
  - _Requirements: 1.2, 1.5, 3.2_

- [ ] 2.3 ストリーミング応答の透過中継機能を実装
  - 上位サーバーからの SSE ストリームを逐次中継する処理を実装
  - `ReadableStream` をそのまま返却する機能を実装
  - ストリーム開始前のエラー検出と処理を実装
  - _Requirements: 3.3_

- [ ] 2.4 エラーハンドリング機能の実装
  - ネットワークエラー・タイムアウト時の 504 エラーレスポンスを生成
  - 予期しない例外発生時の 500 エラーレスポンスを生成
  - 上位サーバーからの不完全な応答を正規化したエラーレスポンスを生成
  - 上位サーバーエラーをそのまま透過的に返却する処理を実装（Auth Passthrough モードでは上位サーバーからの 401 を含む）
  - OpenAI 互換エラー形式 (`error.message`, `error.type`, `error.param`,`error.code`) を生成するヘルパー関数を実装
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 3. ルーティングロジックの実装
- [ ] 3.1 (P) モデル名に基づく振り分け判定機能を実装
  - モデル名に `gemini` または `claude` (大文字小文字無視) が含まれる場合、Antigravity へルーティング
  - それ以外の場合、上位サーバーへルーティング
  - 純粋関数として実装 (副作用なし、同じ入力には同じ出力)
  - _Requirements: 2.1, 2.2_

- [ ] 3.2 Router レイヤーに分岐ロジックを統合
  - `POST /v1/chat/completions` ハンドラーに分岐ロジックを追加
  - エイリアス解決（`ModelRoutingService`）後にルーティング判定を実行
  - `model` フィールドの厳密なバリデーションを実装（欠損、null、空文字列を検出）
  - `model` フィールドが不正な場合、要件通りのエラーメッセージとステータス 400 を返却
  - 上位サーバールート選択時に `OpenAIPassthroughService` が未設定の場合は内部エラーを返却
  - Auth Passthrough モード（`OPENAI_API_KEY` 未設定）でもリクエストを転送（401 エラーを返さない）
  - Antigravity ルートは既存の `TransformService` フローを維持
  - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.2, 5.3_

- [ ] 4. サービス初期化とワイアリング
- [ ] 4.1 main.ts のサービス初期化処理を拡張
  - `createAppContext` に `OpenAIConfigService` の初期化を追加
  - 設定サービスを依存性として `OpenAIPassthroughService` に注入
  - `CreateProxyAppOptions` に `openaiService` オプションを追加
  - `AppContext` に新規サービスを追加
  - 設定状態に応じたログ出力を実装:
    - `isConfigured() === true`: "OpenAI passthrough service initialized with server API key"
    - `isConfigured() === false`: "OpenAI passthrough service initialized in Auth Passthrough mode (client Authorization header will be used)"
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.3_

- [ ] 5. テストの実装
- [ ] 5.1* ユニットテストの実装
  - モデル名判定ロジックのテスト（各パターンで正しい振り分けを確認）
  - 設定サービスのテスト（環境変数設定/未設定時の動作、Base URL のデフォルト値を確認）
  - エラーレスポンス生成ヘルパーのテスト（OpenAI 互換形式の正確性を確認）
  - ヘッダー処理ロジックのテスト（Auth Passthrough モード：API キー設定/未設定時の Authorization ヘッダー処理、Host 除外、その他保持を確認）
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.2, 4.1, 4.2, 4.3, 4.4_

- [ ] 5.2* 統合テストの実装
  - Antigravity ルートのテスト（gemini/claude モデルが TransformService に流れることを確認）
  - 上位サーバールートのテスト（gpt モデルが OpenAIPassthroughService に流れることを確認）
  - Auth Passthrough モードのテスト（`OPENAI_API_KEY` 未設定時、クライアント `Authorization` ヘッダーが転送されることを確認）
  - 既存機能の回帰テスト（ModelRoutingService によるエイリアス解決が維持されることを確認）
  - _Requirements: 1.2, 1.5, 2.1, 2.2, 5.1, 5.2, 5.3_

---

## 要件カバレッジマトリックス

| 要件 ID | 概要 | 対応タスク |
|---------|------|-----------|
| 1.1 | 環境変数 `OPENAI_API_KEY` の使用 | 1.1, 4.1, 5.1 |
| 1.2 | Auth Passthrough モード（API キー未設定時、クライアントヘッダー転送） | 1.1, 2.2, 3.2, 4.1, 5.1, 5.2 |
| 1.3 | 環境変数 `OPENAI_BASE_URL` の使用 | 1.1, 4.1, 5.1 |
| 1.4 | `OPENAI_BASE_URL` 未設定時のデフォルト値 (`https://api.openai.com`) | 1.1, 5.1 |
| 1.5 | `OPENAI_API_KEY` 設定時、クライアント `Authorization` ヘッダーを無視 | 2.2, 5.2 |
| 2.1 | gemini/claude モデルは Antigravity へ | 3.1, 3.2, 5.1, 5.2 |
| 2.2 | その他のモデルは上位サーバーへ | 3.1, 3.2, 5.1, 5.2 |
| 2.3 | model フィールド欠損時の 400 エラー | 3.2, 5.1 |
| 3.1 | スキーマ変換なしで転送 | 2.1 |
| 3.2 | ヘッダー処理（Authorization 条件分岐、その他保持） | 2.2, 5.1 |
| 3.3 | ストリーミング応答の逐次中継 | 2.3 |
| 3.4 | 上位サーバーからのレスポンスをそのまま返却 | 2.1 |
| 4.1 | 上流エラーの透過的な返却（Auth Passthrough モードでは上位サーバーの 401 を含む） | 2.4 |
| 4.2 | ネットワークエラー時の 504 エラー | 2.4, 5.1 |
| 4.3 | 内部エラー時の 500 エラー | 2.4, 5.1 |
| 4.4 | 不完全な応答時の正規化エラー | 2.4, 5.1 |
| 5.1 | `/v1/chat/completions` エンドポイントの維持 | 3.2, 5.2 |
| 5.2 | モデル名に応じた自動経路選択 | 3.1, 3.2, 5.2 |
| 5.3 | 追加設定不要 | 3.2, 4.1, 5.2 |

---

## 実装の優先順位

1. **フェーズ 1: 設定基盤** (タスク 1.1)
   - `OPENAI_API_KEY` / `OPENAI_BASE_URL` 環境変数管理

2. **フェーズ 2: コア実装** (タスク 2.1, 2.2, 2.3, 2.4, 3.1)
   - パススルーサービス、Auth Passthrough、ルーティングロジック

3. **フェーズ 3: 統合** (タスク 3.2, 4.1)
   - Router 拡張、サービス初期化とワイアリング

4. **フェーズ 4: 検証** (タスク 5.1, 5.2)
   - ユニットテスト、統合テスト

---

## 技術的な注意事項

### 既存コンポーネントとの連携
- `ModelRoutingService`: エイリアス解決は既存フローを維持
- `TransformService`: Antigravity ルートは既存の変換処理を使用
- `proxy-router.ts`: 分岐ロジックを追加、既存フローへの影響を最小化

### Auth Passthrough モードの仕様
- **モード判定**: `configService.getApiKey()` が `undefined` の場合に Auth Passthrough モードとなる
- **動作**: クライアントの `Authorization` ヘッダーをそのまま上位サーバーへ転送
- **エラー処理**: Auth Passthrough モードでクライアントのキーが無効な場合、上位サーバーからの 401 エラーがそのままクライアントに返される

### セキュリティ
- サーバー側の `OPENAI_API_KEY` は環境変数から読み込み、ログに出力しない
- Auth Passthrough モードでは、クライアントが自身の API キーを管理する責任を負う
- レスポンスへの API キー露出を防止
