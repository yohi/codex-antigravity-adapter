## codex-antigravity-adapter

Codex CLI 向けの Antigravity Adapter（ローカルプロキシ）です。サーバー起動は `Bun.serve` をデフォルト実装として利用するため、実行時ランタイムに Bun が必要です。

## 必要要件（Runtime）

- Bun（`>= 1.2.19`、このバージョンで動作確認）

## 実行方法（Bun）

1. 環境変数を設定（`.env.example` 参照）
2. 起動:
   - 開発: `bun run dev`
   - 本番相当: `bun run start`
3. テスト: `bun test`

### E2E 検証

実環境の OAuth 認証と Antigravity API を利用する E2E テストは、明示的に有効化した場合のみ実行されます。

1. 事前に `/login` で OAuth 認証を完了し、`~/.codex/antigravity-tokens.json` が存在することを確認
2. 実行:
   - `RUN_E2E=1 bun test tests/e2e.test.ts`

任意のフラグ/設定:
- `E2E_USE_RUNNING_SERVER=1`: すでに起動済みのサーバーを利用
- `E2E_AUTH_URL` / `E2E_PROXY_URL`: 認証/プロキシのベース URL を変更
- `E2E_TOKEN_PATH`: トークンファイルのパスを変更
- `E2E_MODEL` / `E2E_TOOL_MODEL`: 検証に使うモデル ID を変更
- `E2E_TOOL_FLOW=1`: tool 呼び出しの往復テストを有効化
- `E2E_REFRESH_FLOW=1`: 期限切れトークンの更新フローを検証（トークンファイルを書き換えるため注意）

## Bun 以外の環境について（serve の差し替え）

`src/proxy/proxy-router.ts` の `startProxyServer` は、デフォルトで `Bun.serve` を呼びますが、`options.serve` を渡すことで独自のサーバー起動処理を注入できます（テスト/非Bun環境向け）。

例（カスタム `serve` を渡す）:

```ts
import { createProxyApp, startProxyServer } from "./src/proxy/proxy-router";
import type { ProxyTokenStore, ProxyTransformService } from "./src/proxy/proxy-router";

const tokenStore: ProxyTokenStore = {
  // 期待シグネチャ: `getAccessToken(): Promise<{ ok: true; value: { accessToken; projectId } } | { ok: false; error: { requiresReauth; message } }>`（簡易スタブ）
  getAccessToken: async () => ({
    ok: false,
    error: { requiresReauth: true, message: "Missing token" },
  }),
};

const transformService: ProxyTransformService = {
  // 期待シグネチャ: `handleCompletion(input, tokens): Promise<output>`（簡易スタブ）
  handleCompletion: async (_input, _tokens) => ({ id: "stubbed-response" }),
};

const app = createProxyApp({ tokenStore, transformService });

startProxyServer(app, {
  serve: ({ fetch, port, hostname }) => {
    // `port` と `hostname` は省略可能（デフォルト: port=3000, hostname="127.0.0.1"）
    // ここで任意のHTTPサーバ実装に `fetch` を接続する（テスト用スタブでも可）
    return { stop: () => undefined };
  },
});
```
