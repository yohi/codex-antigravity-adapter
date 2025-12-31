# 要件定義書

## イントロダクション
OpenAI Passthrough ルーターは、OpenAI 互換クライアントからのリクエストを `model` 名に基づいて Antigravity または OpenAI に自動で振り分ける機能を提供する。これにより、クライアントは単一のエンドポイント設定で複数のモデルをシームレスに利用できる。

## 要件

### Requirement 1: 環境設定と認証キー
**Objective:** 運用者として、OpenAI API キーを環境変数で管理し、OpenAI への認証を安全に行いたい。

#### 受入基準
1. When 起動時に `OPENAI_API_KEY` が設定されている, the OpenAI Passthrough ルーター shall OpenAI への認証にその値を使用する。
2. When OpenAI 互換ルートへのリクエストが発生し、`OPENAI_API_KEY` が未設定である, the OpenAI Passthrough ルーター shall HTTP ステータス 401 (Unauthorized) とともに、以下の形式のエラー応答を返す:
   ```json
   {
     "error": {
       "message": "OpenAI API key is not configured on the router",
       "type": "invalid_request_error",
       "param": null,
       "code": "router_api_key_missing"
     }
   }
   ```
   Note: このエラーはルーター側の設定不備を示し、OpenAI 上流からの 401 エラーとは `code` フィールドで区別できる。
3. The OpenAI Passthrough ルーター shall OpenAI API キーをクライアントに要求しない。

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

### Requirement 3: OpenAI パススルーの忠実性
**Objective:** クライアントとして、OpenAI 互換のリクエストとレスポンスを変換せずに利用したい。

#### 受入基準
1. When OpenAI 互換ルートへ転送する, the OpenAI Passthrough ルーター shall クライアントの JSON ボディをスキーマ変換せずにそのまま転送する。
2. When OpenAI 互換ルートへ転送する, the OpenAI Passthrough ルーター shall 以下のヘッダー処理を行う:
   - クライアント由来の `Authorization` ヘッダーは**無視**する（上書きする）。
   - サーバー側の `OPENAI_API_KEY` を使用して、`Authorization: Bearer {OPENAI_API_KEY}` ヘッダーを**設定**する。
   - その他のクライアントヘッダー（例: `Content-Type`, `User-Agent`, カスタムヘッダー）は**保持**して転送する。
   - ただし、以下のヘッダーは転送**しない**: `Host`（OpenAI のホストに置き換え）、`Content-Length`（自動計算）。
3. When クライアントがストリーミング応答を要求する, the OpenAI Passthrough ルーター shall OpenAI のストリーミング応答を逐次中継する。
4. The OpenAI Passthrough ルーター shall OpenAI からのレスポンスステータスと本文をそのまま返す。

### Requirement 4: エラー処理
**Objective:** 利用者として、認証失敗や上流エラーを判別できる標準的な OpenAI 形式の応答を受け取りたい。

#### 受入基準
1. **ルーター側の認証失敗（OPENAI_API_KEY 未設定）**:
   When OpenAI 互換ルートへのリクエストが発生し、`OPENAI_API_KEY` が未設定である, the OpenAI Passthrough ルーター shall HTTP ステータス 401 (Unauthorized) とともに、以下のエラー応答を返す:
   ```json
   {
     "error": {
       "message": "OpenAI API key is not configured on the router",
       "type": "invalid_request_error",
       "param": null,
       "code": "router_api_key_missing"
     }
   }
   ```
   Note: `code` フィールド `"router_api_key_missing"` により、OpenAI 上流の認証エラーと区別可能。

2. **OpenAI 上流からのエラー応答（ステータスと本文が存在する場合）**:
   When OpenAI が HTTP エラーステータス（例: 401, 429, 500, 503）とエラー本文を返す, the OpenAI Passthrough ルーター shall OpenAI から受信したステータスコードとエラー本文を**そのまま（verbatim）**クライアントに返す。

   例1: OpenAI 上流の認証失敗（401）:
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

   例2: OpenAI のレート制限（429）:
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

3. **ネットワークエラー・タイムアウト**:
   When OpenAI への接続中にネットワークエラーまたはタイムアウトが発生する, the OpenAI Passthrough ルーター shall HTTP ステータス 504 (Gateway Timeout) とともに、以下の OpenAI 互換エラー応答を返す:
   ```json
   {
     "error": {
       "message": "Failed to connect to OpenAI API: network timeout",
       "type": "api_error",
       "param": null,
       "code": "router_network_timeout"
     }
   }
   ```

4. **予期しない例外・内部エラー**:
   When OpenAI からの応答処理中に予期しない例外が発生する, the OpenAI Passthrough ルーター shall HTTP ステータス 500 (Internal Server Error) とともに、以下の OpenAI 互換エラー応答を返す:
   ```json
   {
     "error": {
       "message": "Internal router error occurred while processing OpenAI request",
       "type": "api_error",
       "param": null,
       "code": "router_internal_error"
     }
   }
   ```

5. **OpenAI からの不完全な応答**:
   When OpenAI からステータスコードは受信したが本文が不正またはパース不可能である, the OpenAI Passthrough ルーター shall 受信したステータスコードとともに、以下の正規化された OpenAI 互換エラー応答を返す:
   ```json
   {
     "error": {
       "message": "OpenAI returned an invalid or unparseable response",
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
