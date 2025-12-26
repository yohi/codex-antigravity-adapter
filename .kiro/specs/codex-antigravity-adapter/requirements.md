# 要件定義書

## はじめに
Codex CLI 用 Antigravity Adapter (ローカルプロキシ) を提供し、Google Antigravity API への OAuth 認証フローと OpenAI 互換のチャット補完 API を備える。opencode-antigravity-auth から移植したリクエスト/レスポンス変換と署名仕様に準拠した動作を要件とする。

## 要件

### Requirement 1: ローカルプロキシの提供
**目的:** Codex CLI 利用者として、ローカルプロキシ経由で Google Antigravity API を利用したい。そうすることで既存の CLI 操作から OpenAI 互換の呼び出しを行える。

#### 受け入れ基準
1. The Antigravity Adapter shall ローカルプロキシとして HTTP リクエストを受け付ける。
2. When サービスが起動されたとき、the Antigravity Adapter shall OAuth 認証フロー用の HTTP エンドポイントをポート 51121 で公開する。
3. When サービスが起動されたとき、the Antigravity Adapter shall OpenAI 互換チャット補完用の HTTP エンドポイントをポート 3000 で公開する。
4. If 未対応のエンドポイントにリクエストが届いたとき、the Antigravity Adapter shall クライアントが判別できるエラー応答を返す。

### Requirement 2: Google Antigravity OAuth 認証
**目的:** 利用者として Google Antigravity API の OAuth 認可を完了したい。そうすることで API 呼び出しに必要なトークンを取得できる。

#### 受け入れ基準
1. When 認証フロー開始が要求されたとき、the Antigravity Adapter shall Google Antigravity API の OAuth 認可 URL を提示する。
2. When 認可コード付きのコールバックを受信したとき、the Antigravity Adapter shall 認可コードをアクセストークンへ交換する。
3. When トークン取得に成功したとき、the Antigravity Adapter shall 取得したトークンを後続の API 呼び出しで利用できるように保持する。
4. If トークン取得に失敗したとき、the Antigravity Adapter shall 認証失敗の理由が分かるエラー応答を返す。
5. If 有効なトークンが存在しないとき、the Antigravity Adapter shall 認証が必要である旨のエラーを返す。

### Requirement 3: OpenAI 互換チャット補完 API
**目的:** Codex CLI 利用者として OpenAI 互換のチャット補完 API を利用したい。そうすることで既存のクライアント実装を変更せずに利用できる。

#### 受け入れ基準
1. When チャット補完リクエストを受信したとき、the Antigravity Adapter shall OpenAI 互換スキーマに従って内容を検証する。
2. If リクエストが OpenAI 互換スキーマに適合しないとき、the Antigravity Adapter shall バリデーションエラーを返す。
3. When 有効なチャット補完リクエストを受信したとき、the Antigravity Adapter shall Google Antigravity API へリクエストを送信する。
4. When Google Antigravity API の応答を受信したとき、the Antigravity Adapter shall OpenAI 互換のチャット補完レスポンスを返す。
5. If Google Antigravity API がエラーを返したとき、the Antigravity Adapter shall OpenAI 互換のエラー形式で返す。

### Requirement 4: 変換ロジックと署名ブロック処理の互換性
**目的:** 開発者として opencode-antigravity-auth で定義された変換と署名ブロック処理仕様を引き継ぎたい。そうすることで既存の動作互換性を維持できる。

#### 受け入れ基準
1. When OpenAI 互換のチャット補完リクエストを受信したとき、the Antigravity Adapter shall opencode-antigravity-auth の仕様に従って Antigravity API 向けスキーマへ変換する。
2. When Antigravity API へリクエストを送信するとき、the Antigravity Adapter shall opencode-antigravity-auth の thinking 署名ブロック処理方式に従ってリクエストを処理する。
3. When Antigravity API の応答を受信したとき、the Antigravity Adapter shall opencode-antigravity-auth の仕様に従って OpenAI 互換スキーマへ変換する。
4. If 変換や署名に必要な入力が欠けているとき、the Antigravity Adapter shall 変換または署名の失敗を示すエラーを返す。
