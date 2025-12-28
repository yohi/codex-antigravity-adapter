# codex-antigravity-adapter

Codex CLI 向けの Antigravity Adapter（ローカルプロキシ）です。
Google の内部 API である Antigravity (Cloud Code Assist) API と通信するためのローカルサーバーとして動作し、OpenAI 互換のインターフェースを提供します。

## 主な機能

- **ローカルプロキシ**: OpenAI 互換の `/v1/chat/completions` エンドポイントを提供し、Codex CLI から利用可能にします。
- **プロトコル変換**:
  - OpenAI 形式 (`messages`) から Antigravity 形式 (`contents`) への変換。
  - Antigravity SSE ストリームから OpenAI 互換 SSE への変換。
  - ツール呼び出しのための JSON スキーマ変換。
- **認証管理**:
  - Google OAuth2 フロー（ヘッドレス/コールバック）の管理。
  - アクセストークンの永続化と自動リフレッシュ。
- **互換性**:
  - Claude モデル（署名検証のための "Thinking" ブロック削除処理を含む）および Gemini モデルのサポート。
  - "Invalid signature" エラーを回避するためのリクエストサニタイズ。

## 必要要件

- **Runtime**: [Bun](https://bun.sh/) (`>= 1.2.19`)
- **Google Cloud Project**: Antigravity API にアクセス可能な Google アカウントと OAuth クライアント ID/Secret。

## セットアップ

1. **リポジトリのクローンと依存関係のインストール**
   ```bash
   git clone <repository-url>
   cd codex-antigravity-adapter
   bun install
   ```

2. **環境変数の設定**
   `.env.example` をコピーして `.env` を作成し、必要な値を設定してください。
   ```bash
   cp .env.example .env
   ```

   **必須設定 (.env):**
   - `ANTIGRAVITY_CLIENT_ID`: Google OAuth クライアント ID
   - `ANTIGRAVITY_CLIENT_SECRET`: Google OAuth クライアントシークレット

   **推奨設定:**
   - `ANTIGRAVITY_STATE_SECRET`: OAuth 状態署名用のシークレット（ランダムな文字列を設定してください）

3. **Codex CLI の設定**
   Codex CLI (または IDE 拡張) からこのアダプターを利用するには、設定ファイル `~/.codex/config.toml` を編集してカスタムモデルプロバイダーとして登録します。

   ### 設定ファイルの場所
   - **Linux / macOS**: `~/.codex/config.toml`
   - **Windows**: `C:\Users\<YourUsername>\.codex\config.toml`

   ### モデルプロバイダーの登録と指定

   `~/.codex/config.toml` に以下の設定を追加します。

   ```toml
   # 1. モデルプロバイダーの定義
   [model_providers.antigravity]
   name = "Antigravity Adapter"
   base_url = "http://localhost:3000/v1"
   # アダプターが Google OAuth2 で認証を行うため、キーは任意の文字列で構いません
   env_key = "ANTIGRAVITY_ADAPTER_DUMMY"

   # 2. デフォルトで使用するモデルとプロバイダーの指定（ファイル上部）
   model = "gemini-3-pro-high"
   model_provider = "antigravity"
   ```

   **利用可能な主要モデル ID:**
   - `gemini-3-pro-high` / `gemini-3-pro-low`: Gemini Pro モデル
   - `gemini-3-flash`: 高速な Gemini Flash モデル
   - `claude-sonnet-4-5-thinking`: Claude 3.5 Sonnet (Thinking 有効)
   - `claude-opus-4-5-thinking`: Claude 3 Opus (Thinking 有効)

   ### プロファイルの活用（応用）

   プロジェクトごとに設定を使い分けたい場合、プロファイル機能が便利です。

   ```toml
   [profiles.claude]
   model = "claude-sonnet-4-5-thinking"
   model_provider = "antigravity"

   [profiles.flash]
   model = "gemini-3-flash"
   model_provider = "antigravity"
   ```

   プロファイルを指定して実行する例:

   ```bash
   codex --profile claude "コードのリファクタリング案を出して"
   ```

   詳細な設定オプションについては、[公式ドキュメント: Configuring Codex](https://developers.openai.com/codex/local-config/) を参照してください。

## 実行方法

1. **サーバーの起動**
   - 開発モード（ホットリロード有効）:

     ```bash
     bun run dev
     ```
   - 本番相当:

     ```bash
     bun run start
     ```

   デフォルトでは `http://localhost:3000` で起動します。

2. **初回認証**
   Codex CLI から最初のリクエストを行うと、認証が必要な場合にはコンソールに認証用 URL が表示されるか、ブラウザでの認証フローが開始されます。認証が完了するとトークンが保存され、以降は自動的に利用されます。

## 開発とテスト

### テストの実行

```bash
bun test
```

### E2E 検証

実環境の OAuth 認証と Antigravity API を利用する E2E テストは、環境変数を指定した場合のみ実行されます。

1. **事前準備**: `/login` エンドポイントなどで OAuth 認証を完了させ、トークンファイル（デフォルト: `~/.codex/antigravity-tokens.json`）が存在する状態にします。
2. **実行**:

   ```bash
   RUN_E2E=1 bun test tests/e2e.test.ts
   ```

   **オプション設定:**
   - `E2E_USE_RUNNING_SERVER=1`: すでに起動済みのサーバー（localhost:3000）を利用してテストします。
   - `E2E_AUTH_URL` / `E2E_PROXY_URL`: テスト対象の URL を変更します。
   - `E2E_MODEL`: 検証に使用するモデル ID を変更します。

## 技術スタックとアーキテクチャ

- **Runtime**: Bun
- **Language**: TypeScript
- **Framework**: Hono
- **Validation**: Zod

### 設計方針

- **Bun-First**: `Bun.serve` を活用し、高速な起動とパフォーマンスを実現しています。
- **標準 Web API**: 外部リクエストライブラリに依存せず、標準の `fetch`, `Request`, `Response` を使用しています。
- **拡張性**: サーバー起動ロジック (`serve`) は注入可能になっており、Bun 以外の環境やテスト時のモック差し替えに対応しています。

### Bun 以外の環境での利用（Advanced）

`src/proxy/proxy-router.ts` の `startProxyServer` に独自の `serve` 実装を渡すことで、Node.js 環境や他のランタイムでの動作も理論上可能です（現状は Bun 推奨）。

## ディレクトリ構造

- `src/auth/`: OAuth 認証フロー、トークン管理
- `src/proxy/`: OpenAI 互換 API のハンドリング、Antigravity へのリクエスト中継
- `src/transformer/`: プロトコル変換ロジック
- `src/config/`: 設定値定義
