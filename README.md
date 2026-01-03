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
- **動的モデルルーティング**:
  - プロンプト内のエイリアスタグ（例: `@fast`）によるモデルの動的切替。
  - プロンプトのサニタイズ（エイリアス除去）によるクリーンな入力の維持。
- **OpenAI Passthrough**:
  - Gemini/Claude 以外のモデル（例: `gpt-4o`, `o1`）へのリクエストを、指定されたアップストリーム（OpenAI API や互換サーバー）へ自動転送します。
  - 認証情報のパススルーや Base URL のカスタマイズをサポート。

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

   **OpenAI Passthrough 設定 (任意):**
   - `OPENAI_API_KEY`: アップストリームへ送信する API キー（未設定時はクライアントのヘッダーをパススルー）
   - `OPENAI_BASE_URL`: アップストリームの Base URL (デフォルト: `https://api.openai.com`)

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

## モデル一覧のカスタマイズ

デフォルトで提供されるモデル以外を利用したい場合、環境変数または設定ファイルを使用してモデルIDを追加できます。
追加されたモデルは `/v1/models` エンドポイントで返され、Codex CLI から利用可能になります。

### 設定方法

以下のいずれか、または両方の方法でモデルを追加できます。

#### 1. 環境変数 (`ANTIGRAVITY_ADDITIONAL_MODELS`)

`.env` ファイルまたは環境変数で指定します。

**JSON配列形式（推奨）:**
```bash
ANTIGRAVITY_ADDITIONAL_MODELS='["gemini-1.5-pro-latest", "claude-3-5-sonnet-20240620"]'
```

**カンマ区切り形式:**
```bash
ANTIGRAVITY_ADDITIONAL_MODELS="gemini-1.5-pro-latest,claude-3-5-sonnet-20240620"
```

#### 2. 設定ファイル (`custom-models.json`)

プロジェクトルート（`./`）または `.codex/` ディレクトリに `custom-models.json` を配置します。

**`custom-models.json` の例:**
```json
{
  "models": [
    "gemini-1.5-pro-latest",
    "claude-3-5-sonnet-20240620",
    "experimental-model-v1"
  ]
}
```

### 設定の優先順位

複数の設定方法が併用された場合、以下の優先順位でマージされます（IDが重複した場合、優先度の高い設定が維持されます）。

1. **環境変数** (`ANTIGRAVITY_ADDITIONAL_MODELS`) - 最高優先
2. **設定ファイル** (`./custom-models.json` または `.codex/custom-models.json`)
   - カレントディレクトリのファイルが優先されます
3. **組み込みモデル** (ハードコードされたリスト) - 最低優先

※ 設定ファイルや環境変数が無効な形式（不正なJSONなど）の場合、警告ログが出力され、その設定は無視されます（サーバーは起動を継続します）。

## 動的モデルルーティング

プロンプトの先頭にエイリアスタグ（例: `@fast`）を付与することで、リクエストごとに使用するモデルを切り替えることができます。
これにより、クライアント側の設定を変更せずに、軽量モデルと高精度モデルを使い分けることが可能になります。

### 使用例

プロンプトの先頭に `@<alias>` を記述します（直後は空白または改行である必要があります）。

```bash
# @fast エイリアスで高速なモデルを使用
codex "@fast このコードのバグを見つけて"

# @think エイリアスで Thinking モデルを使用
codex "@think 複雑なアーキテクチャ設計を行って"
```

エイリアスタグはアダプター側で検出・除去され、実際のモデル ID に置換されてから Antigravity API に送信されます。
（例: `@fast` → `gemini-3-flash`）

### 設定方法

プロジェクトルートに `model-aliases.json` を配置してエイリアスを定義します。

**`model-aliases.json` の例:**

```json
{
  "@fast": "gemini-3-flash",
  "@think": "claude-sonnet-4-5-thinking",
  "@pro": "gemini-3-pro-high"
}
```

- キーは `@` で始まる必要があります。
- 値は有効なモデル ID である必要があります。
- ファイルの変更を反映するには、サーバーの再起動が必要です。

## OpenAI Passthrough

Gemini (Google) や Claude (Anthropic on Vertex) 以外のモデル ID が指定された場合、リクエストを自動的に外部の OpenAI 互換 API へ転送します。

### 動作ロジック

- モデルIDに `gemini` または `claude` が含まれて**いない**場合 → **Passthrough** (OpenAI 側へ転送)
- 含まれている場合 → **Antigravity** (Google 側へ処理)

### 認証の挙動

1. 環境変数 `OPENAI_API_KEY` がある場合: そのキーを使用します。
2. 環境変数がない場合: クライアントが送信した `Authorization` ヘッダーをそのまま転送します。

これにより、たとえば `api.openai.com` だけでなく、ローカルで動作する vLLM や Ollama (`http://localhost:8000/v1` 等) をアップストリームとして設定することも可能です。

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