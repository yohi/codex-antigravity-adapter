# 要件定義書

## イントロダクション
OpenAI Passthrough ルーターは、OpenAI 互換クライアントからのリクエストを `model` 名に基づいて Antigravity または OpenAI に自動で振り分ける機能を提供する。これにより、クライアントは単一のエンドポイント設定で複数のモデルをシームレスに利用できる。

## 要件

### Requirement 1: 環境設定と認証キー
**Objective:** 運用者として、OpenAI API キーを環境変数で管理し、OpenAI への認証を安全に行いたい。

#### 受入基準
1. When 起動時に `OPENAI_API_KEY` が設定されている, the OpenAI Passthrough ルーター shall OpenAI への認証にその値を使用する。
2. When OpenAI 互換ルートへのリクエストが発生し、`OPENAI_API_KEY` が未設定である, the OpenAI Passthrough ルーター shall 認証ができないことを示すエラー応答を返す。
3. The OpenAI Passthrough ルーター shall OpenAI API キーをクライアントに要求しない。

### Requirement 2: モデル名によるルーティング
**Objective:** クライアントとして、`model` 名だけで適切な経路に自動ルーティングされ、設定を増やさずに利用したい。

#### 受入基準
1. When リクエストの `model` 名に "gemini" または "claude" の部分文字列が含まれる, the OpenAI Passthrough ルーター shall Antigravity 互換ルート（既存の TransformService）へ転送する。
2. When リクエストの `model` 名が上記条件のいずれにも該当しない, the OpenAI Passthrough ルーター shall OpenAI 互換ルートへ転送する。
3. If リクエストに `model` フィールドが存在しない, the OpenAI Passthrough ルーター shall モデル未指定を示すエラー応答を返す。

### Requirement 3: OpenAI パススルーの忠実性
**Objective:** クライアントとして、OpenAI 互換のリクエストとレスポンスを変換せずに利用したい。

#### 受入基準
1. When OpenAI 互換ルートへ転送する, the OpenAI Passthrough ルーター shall クライアントの JSON ボディをスキーマ変換せずにそのまま転送する。
2. When OpenAI 互換ルートへ転送する, the OpenAI Passthrough ルーター shall クライアントのヘッダーを保持し、OpenAI 認証情報（Bearer Token）を付随させて転送する。
3. When クライアントがストリーミング応答を要求する, the OpenAI Passthrough ルーター shall OpenAI のストリーミング応答を逐次中継する。
4. The OpenAI Passthrough ルーター shall OpenAI からのレスポンスステータスと本文をそのまま返す。

### Requirement 4: エラー処理
**Objective:** 利用者として、認証失敗や上流エラーを判別できる標準的な OpenAI 形式の応答を受け取りたい。

#### 受入基準
1. If OpenAI が認証失敗を返した, the OpenAI Passthrough ルーター shall OpenAI 互換の認証失敗エラー応答を返す。
2. If OpenAI が上流エラーを返した, the OpenAI Passthrough ルーター shall 上流エラーの内容を反映したエラー応答を返す。

### Requirement 5: 透過性とクライアント設定の簡素化
**Objective:** 利用者として、単一の `base_url` 設定で複数プロバイダーのモデルを利用したい。

#### 受入基準
1. The OpenAI Passthrough ルーター shall OpenAI 互換の `/v1/chat/completions` エンドポイントを維持する。
2. When クライアントが同一のエンドポイントに対して異なる `model` 名を指定してリクエストする, the OpenAI Passthrough ルーター shall モデル名に応じて自動的に経路を選択する。
3. The OpenAI Passthrough ルーター shall モデルごとの追加設定や別エンドポイントの指定をクライアント側に要求しない。
