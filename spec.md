Codex CLIで`opencode-antigravity-auth`と同様に、GoogleのAntigravity（Cloud Code Assist API）経由でGeminiやClaudeを利用するための実装プランを提示します。

Codex CLI（Rust版）は標準でOpenAI互換のAPIをサポートしていますが、Antigravity APIは独自仕様（Gemini形式のリクエスト構造、特殊なOAuthフロー、特殊なエンドポイント）を持つため、**「ローカルプロキシサーバー（Adapter）」**を間に挟む構成が最も確実です。

以下に具体的な実装手順を示します。

### アーキテクチャ構成

```mermaid
graph LR
    Codex[Codex CLI] -- OpenAI互換リクエスト --> LocalProxy[ローカルプロキシ (Node.js/Bun)]
    LocalProxy -- 変換 (request.ts) --> Antigravity[Google Antigravity API]
    Antigravity -- SSE Stream --> LocalProxy
    LocalProxy -- 変換 (response.ts) --> Codex

```

### 1. 認証の実装 (Auth Script)

まず、GoogleアカウントでOAuth認証を行い、リフレッシュトークンを取得するスクリプトが必要です。`opencode-antigravity-auth`の `src/antigravity/oauth.ts` のロジックを流用し、CLI単体で動くようにします。

**必要な処理:**

* `authorizeAntigravity` 関数で認証URLを生成。
* ローカルサーバー（ポート51121）でコールバックを受け取る。
* `exchangeAntigravity` でトークンを交換し、JSONファイル（例: `~/.codex/antigravity-tokens.json`）に保存する。

### 2. ローカルプロキシの構築 (Bridge Server)

LiteLLMを使用するよりも、提供されたプラグインコード（`src/plugin/request.ts` など）を直接利用したNode.js (または Bun) サーバーを立てる方が、Antigravity特有の仕様（Thinking Blockの署名処理やスキーマ変換）に完全対応できます。

以下の機能を実装したサーバーを作成します（例: `http://localhost:3000`）。

**主要ロジックの移植:**

1. **エンドポイント:** `/v1/chat/completions` を受け付ける。
2. **リクエスト変換:**
* CodexからのOpenAI形式（`messages`）を受け取る。
* `src/plugin/request.ts` の `prepareAntigravityRequest` を使用して、Antigravity形式（`contents`）に変換する。
* この際、Claudeモデルの場合はThinkingブロックの削除（署名エラー回避のため）や、ツール定義のサニタイズ（`const`削除など）を `src/plugin/request-helpers.ts` のロジックで行う。


3. **APIリクエスト:**
* 保存したトークンを使用して、`https://daily-cloudcode-pa.sandbox.googleapis.com` (または `cloudcode-pa.googleapis.com`) へリクエストを送信する。


4. **レスポンス変換:**
* AntigravityからのSSEストリームを受け取る。
* `src/plugin/request.ts` の `transformAntigravityResponse` を使用して、OpenAI互換のSSE形式に戻してCodexに返す。



### 3. Codex CLIの設定

ローカルプロキシが立ち上がったら、Codex CLIの設定ファイル `~/.codex/config.toml` を編集し、このプロキシを向くように設定します。

```toml
# ~/.codex/config.toml

# Antigravity用のカスタムプロバイダー設定
[services.antigravity]
type = "openai"  # プロキシがOpenAI互換で振る舞うため
url = "http://localhost:3000/v1"
api_key = "dummy" # プロキシ側で認証するためダミーでOK

# モデルのエイリアス設定
[models]
# プロキシ経由でClaude 3.5 Sonnetを利用
"claude-sonnet-4-5" = { service = "antigravity", name = "claude-sonnet-4-5" }
# プロキシ経由でGemini 3 Proを利用
"gemini-3-pro-high" = { service = "antigravity", name = "gemini-3-pro-high" }

```

### 4. LiteLLMでコンバートする場合の課題と対策

質問にある「LiteLLMでコンバートする」方法は、通常であれば最良の選択肢ですが、Antigravityに関しては以下の課題があります：

1. **エンドポイントが特殊:** LiteLLMの標準Geminiプロバイダーは `generativelanguage.googleapis.com` を使用しますが、Antigravityは `cloudcode-pa.googleapis.com` 等の内部向けエンドポイントを使用します。
2. **ヘッダー要件:** `X-Goog-Api-Client` や `Client-Metadata` などの特定のヘッダーがないと拒否される可能性があります。
3. **Claudeの署名問題:** Antigravity経由のClaudeはThinkingブロックの署名管理が厳格であり、LiteLLM標準の変換では署名エラー（Invalid signature）が発生する可能性が高いです。OpenCodeプラグインはこれを回避するために「リクエストからThinkingブロックを全削除する」という特別な処理を入れています。

**結論:**
もっとも良い方法は、LiteLLMをそのまま使うのではなく、**OpenCodeプラグインのソースコード（特に `src/plugin/request.ts` と `src/plugin/request-helpers.ts`）をimportして使う薄いNode.js/Bunサーバー（Adapter）を作成し、それをCodexのバックエンドとして指定すること**です。これにより、プラグイン作者が解決済みの「Claudeの署名問題」や「JSONスキーマ変換」の恩恵をそのまま受けることができます。
