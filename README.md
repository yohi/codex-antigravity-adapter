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

## Bun 以外の環境について（serve の差し替え）

`src/proxy/proxy-router.ts` の `startProxyServer` は、デフォルトで `Bun.serve` を呼びますが、`options.serve` を渡すことで独自のサーバー起動処理を注入できます（テスト/非Bun環境向け）。

例（カスタム `serve` を渡す）:

```ts
import { createProxyApp, startProxyServer } from "./src/proxy/proxy-router";

const app = createProxyApp({ tokenStore, transformService });

startProxyServer(app, {
  serve: ({ fetch, port, hostname }) => {
    // ここで任意のHTTPサーバ実装に `fetch` を接続する（テスト用スタブでも可）
    return { stop: () => undefined };
  },
});
```
