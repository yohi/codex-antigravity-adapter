# 要件定義書

## イントロダクション
OpenAI Passthrough ルーターは、OpenAI 互換クライアントからのリクエストを `model` 名に基づいて Antigravity または OpenAI に自動で振り分ける機能を提供する。これにより、クライアントは単一のエンドポイント設定で複数のモデルをシームレスに利用できる。

## 要件

### Requirement 1: 環境設定と認証キー
**Objective:** 運用者として、OpenAI API キーと接続先を環境変数で管理し、柔軟な認証設定を行いたい。

#### 受入基準
1. When 起動時に `OPENAI_API_KEY` が設定されている, the OpenAI Passthrough ルーター shall 上位サーバーへの認証にその値を使用する。
2. When 上位サーバー互換ルートへのリクエストが発生し、`OPENAI_API_KEY` が未設定である, the OpenAI Passthrough ルーター shall クライアントから送信された `Authorization` ヘッダーをそのまま上位サーバーへ転送する（Auth Passthrough モード）。
   Note: これにより、サーバー側にキーを設定しなくても、クライアント（Codex CLI）が持つ API キーで上位サーバーを利用可能。
3. When 起動時に `OPENAI_BASE_URL` が設定されている, the OpenAI Passthrough ルーター shall その URL を接続先として使用する。
4. When `OPENAI_BASE_URL` が未設定である, the OpenAI Passthrough ルーター shall デフォルト値 `https://api.openai.com` を接続先として使用する。
5. The OpenAI Passthrough ルーター shall `OPENAI_API_KEY` が設定されている場合、クライアントの `Authorization` ヘッダーを無視し、サーバー側のキーを使用する。

### Requirement 2: モデル名によるルーティング
**Objective:** クライアントとして、`model` 名だけで適切な経路に自動ルーティングされ、設定を増やさずに利用したい。

#### 受入基準
1. When リクエストの `model` 名に "gemini" または "claude" の部分文字列が含まれる, the OpenAI Passthrough ルーター shall Antigravity 互換ルート（既存の TransformService）へ転送する。
2. When リクエストの `model` 名が上記条件のいずれにも該当しない, the OpenAI Passthrough ルーター shall OpenAI 互換ルートへ転送する。
3. If リクエストの `model` フィールドが存在しない、null、または空文字列である, the OpenAI Passthrough ルーター shall HTTP ステータス 400 (Bad Request) とともに、以下の形式の OpenAI 互換エラー応答を返す:
   ```json
   {
     "error": {
       "message": "Missing required parameter: 'model'",
       "type": "invalid_request_error",
       "param": "model",
       "code": null
     }
   }
   ```
   Note: `model` が欠落、`null`、`""` のいずれの場合も同一のエラー応答を返す。

### Requirement 3: パススルーの忠実性
**Objective:** クライアントとして、OpenAI 互換のリクエストとレスポンスを変換せずに利用したい。

#### 受入基準
1. When 上位サーバー互換ルートへ転送する, the OpenAI Passthrough ルーター shall クライアントの JSON ボディをスキーマ変換ずにそのまま転送する。
2. When 上位サーバー互換ルートへ転送する, the OpenAI Passthrough ルーター shall 以下のヘッダー処理を行う:
   - **`OPENAI_API_KEY` が設定されている場合**:
     - クライアント由来の `Authorization` ヘッダーは**無視**する（上書きする）。
     - サーバー側の `OPENAI_API_KEY` を使用して、`Authorization: Bearer {OPENAI_API_KEY}` ヘッダーを**設定**する。
   - **`OPENAI_API_KEY` が未設定の場合（Auth Passthrough モード）**:
     - クライアント由来の `Authorization` ヘッダーを**そのまま転送**する。
   - その他のクライアントヘッダー（例: `Content-Type`, `User-Agent`, カスタムヘッダー）は**保持**して転送する。
   - ただし、以下のヘッダーは転送**しない**: `Host`（上位サーバーのホストに置き換え）、`Content-Length`（自動計算）。
3. When クライアントがストリーミング応答を要求する, the OpenAI Passthrough ルーター shall 上位サーバーのストリーミング応答を逐次中継する。
4. The OpenAI Passthrough ルーター shall 上位サーバーからのレスポンスステータスと本文をそのまま返す。

### Requirement 4: エラー処理
**Objective:** 利用者として、認証失敗や上流エラーを判別できる標準的な OpenAI 形式の応答を受け取りたい。

#### 受入基準
1. **上流からのエラー応答（ステータスと本文が存在する場合）**:
   When 上位サーバーが HTTP エラーステータス（例: 401, 429, 500, 503）とエラー本文を返す, the OpenAI Passthrough ルーター shall 上位サーバーから受信したステータスコードとエラー本文を**そのまま（verbatim）**クライアントに返す。
   Note: Auth Passthrough モードでクライアントのキーが無効な場合、上位サーバーからの 401 エラーがそのままクライアントに返される。

   例1: 上流の認証失敗（401）:
   ```json
   {
     "error": {
       "message": "Incorrect API key provided: sk-***",
       "type": "invalid_request_error",
       "param": null,
       "code": "invalid_api_key"
     }
   }
   ```

   例2: 上流のレート制限（429）:
   ```json
   {
     "error": {
       "message": "Rate limit exceeded",
       "type": "rate_limit_error",
       "param": null,
       "code": "rate_limit_exceeded"
     }
   }
   ```

2. **ネットワークエラー・タイムアウト**:
   When 上位サーバーへの接続中にネットワークエラーまたはタイムアウトが発生する, the OpenAI Passthrough ルーター shall HTTP ステータス 504 (Gateway Timeout) とともに、以下の OpenAI 互換エラー応答を返す:
   ```json
   {
     "error": {
       "message": "Failed to connect to upstream API: network timeout",
       "type": "api_error",
       "param": null,
       "code": "router_network_timeout"
     }
   }
   ```

3. **予期しない例外・内部エラー**:
   When 上位サーバーからの応答処理中に予期しない例外が発生する, the OpenAI Passthrough ルーター shall HTTP ステータス 500 (Internal Server Error) とともに、以下の OpenAI 互換エラー応答を返す:
   ```json
   {
     "error": {
       "message": "Internal router error occurred while processing upstream request",
       "type": "api_error",
       "param": null,
       "code": "router_internal_error"
     }
   }
   ```

4. **上流からの不完全な応答**:
   When 上位サーバーからステータスコードは受信したが本文が不正またはパース不可能である, the OpenAI Passthrough ルーター shall 受信したステータスコードとともに、以下の正規化された OpenAI 互換エラー応答を返す:
   ```json
   {
     "error": {
       "message": "Upstream server returned an invalid or unparseable response",
       "type": "api_error",
       "param": null,
       "code": "router_upstream_response_invalid"
     }
   }
   ```

### Requirement 5: 透過性とクライアント設定の簡素化
**Objective:** 利用者として、単一の `base_url` 設定で複数プロバイダーのモデルを利用したい。

#### 受入基準
1. The OpenAI Passthrough ルーター shall OpenAI 互換の `/v1/chat/completions` エンドポイントを維持する。
2. When クライアントが同一のエンドポイントに対して異なる `model` 名を指定してリクエストする, the OpenAI Passthrough ルーター shall モデル名に応じて自動的に経路を選択する。
3. The OpenAI Passthrough ルーター shall モデルごとの追加設定や別エンドポイントの指定をクライアント側に要求しない。
