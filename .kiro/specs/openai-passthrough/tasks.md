# 実装計画: OpenAI Passthrough

## 概要

OpenAI Passthrough ルーターは、モデル名に基づいて Antigravity または OpenAI API にリクエストを自動で振り分ける機能を提供します。クライアントは単一のエンドポイント設定で複数のプロバイダーのモデルをシームレスに利用できます。

---

## タスク

- [ ] 1. 設定サービスの実装
- [ ] 1.1 OpenAI API キー管理機能の実装
  - 環境変数 `OPENAI_API_KEY` からキーを読み込む機能を実装
  - キーの存在チェック機能を提供
  - サービスの初期化状態を確認するインターフェースを実装
  - タイムアウト設定を環境変数から読み込む機能を実装
    - `OPENAI_PASSTHROUGH_CONNECTION_TIMEOUT_MS`: 接続/開始タイムアウト（デフォルト: `10000` ms）
    - `OPENAI_PASSTHROUGH_IDLE_TIMEOUT_MS`: アイドル/ハートビートタイムアウト（デフォルト: `30000` ms）
    - 環境変数が未設定の場合はデフォルト値を使用
    - 環境変数が数値として無効な場合はデフォルト値にフォールバック
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. OpenAI パススルーサービスの実装
- [ ] 2.1 OpenAI API との通信基盤を構築
  - OpenAI API エンドポイントへのリクエスト送信機能を実装
  - 標準 `fetch` API を使用した HTTP クライアントロジックを実装
  - タイムアウト設定と信号制御を実装
    - **接続/開始タイムアウト**: デフォルト 10 秒（OpenAI へのリクエスト送信開始から初回バイト受信まで）
    - **アイドル/ハートビートタイムアウト**: デフォルト 30 秒（ストリーミング中のメッセージ間隔）
    - `AbortController` を使用してタイムアウト時にリクエストをキャンセル
    - タイムアウト値は設定可能とし、環境変数 `OPENAI_PASSTHROUGH_CONNECTION_TIMEOUT_MS` と `OPENAI_PASSTHROUGH_IDLE_TIMEOUT_MS` で上書き可能
  - リクエストボディをスキーマ変換せずに転送する処理を実装
  - _Requirements: 3.1, 3.4_

- [ ] 2.2 ヘッダー処理ロジックの実装
  - クライアントの `Authorization` ヘッダーを無視し、サーバー側 API キーで上書きする処理を実装
  - `Host` と `Content-Length` ヘッダーを除外する処理を実装
  - その他のクライアントヘッダーを保持して転送する処理を実装
  - _Requirements: 3.2_

- [ ] 2.3 ストリーミング応答の透過中継機能を実装
  - OpenAI からの SSE ストリームを逐次中継する処理を実装
  - `ReadableStream` をそのまま返却する機能を実装
  - ストリーム開始前のエラー検出と処理を実装
    - **HTTP ステータスチェック**: OpenAI への fetch リクエスト完了時、`response.status` をチェック
      - `status !== 200` の場合、エラーとして処理（ストリーム読み込み開始前に中断）
      - エラーレスポンスボディを JSON としてパースし、OpenAI 互換エラー形式で返却
    - **初回チャンク検証フロー**:
      - `status === 200` の場合でも、最初の SSE イベントまたは JSON レスポンスを読み取る
      - 初回バイト列が有効な JSON として `{ "error": { ... } }` 形式を持つ場合、エラーとして処理
      - 初回 SSE イベントがエラートークンを含む場合（例: `data: {"error": {...}}`）、ストリームを中断しエラーを返却
    - **タイムアウト検出**:
      - 接続タイムアウトまたはアイドルタイムアウトを超過した場合、`AbortSignal` がトリガー
      - クライアントはタイムアウトエラー（504 Gateway Timeout）を生成し、OpenAI 互換エラー形式で返却
    - **エラー時のストリーム破棄**: エラー検出時は `ReadableStream` を即座にキャンセルし、接続をクローズ
    - エラーメッセージは OpenAI 互換エラー形式で統一（`error.message`, `error.type`, `error.code` を含む）
  - _Requirements: 3.3_

- [ ] 2.4 エラーハンドリング機能の実装
  - API キー未設定時の 401 エラーレスポンスを生成
  - ネットワークエラー・タイムアウト時の 504 エラーレスポンスを生成
  - 予期しない例外発生時の 500 エラーレスポンスを生成
  - **OpenAI からの不完全な応答を正規化したエラーレスポンスを生成**
    - 詳細は「[不完全な応答の検出基準と正規化エラー定義](#不完全な応答の検出基準と正規化エラー定義)」セクションを参照
    - 以下の 5 つの検出基準を実装:
      1. 切り捨てられた/部分的な JSON パースエラー
      2. 予期された終了前のストリーム終了
      3. Content-Length ミスマッチ
      4. 必須フィールドの欠損
      5. SSE プロトコル/フレームエラー
    - 各ケースで診断情報 (`diagnostics`) を含む正規化エラーレスポンスを生成
    - ステータスコード: `502 Bad Gateway`（すべての不完全応答エラー）
  - OpenAI 上流エラーをそのまま透過的に返却する処理を実装
  - OpenAI 互換エラー形式 (`error.message`, `error.type`, `error.param`, `error.code`) を生成するヘルパー関数を実装
  - _Requirements: 1.2, 4.1, 4.2, 4.3, 4.4_

- [ ] 3. ルーティングロジックの実装
- [ ] 3.1 モデル名に基づく振り分け判定機能を実装
  - **決定的でケース非依存のトークンベース照合ルール**:
    1. モデル名を小文字に正規化 (例: `"Gemini"` → `"gemini"`)
    2. 非英数字の境界で分割してトークン化 (正規表現: `/[^a-z0-9]+/`)
    3. 各トークンについて以下をチェック:
       - トークンが `"gemini"` または `"claude"` と完全一致
       - トークンが `"gemini"` または `"claude"` で始まる (例: `"gemini15"`, `"claudev2"`)
    4. いずれかのトークンが条件を満たす場合、**Antigravity ルート**と判定
    5. すべてのトークンが条件を満たさない場合、**OpenAI ルート**と判定
  - **純粋関数として実装** (副作用なし、同じ入力には同じ出力)
  - **エッジケースの例**:
    - ✅ Antigravity にルーティング:
      - `"Gemini"` → トークン: `["gemini"]` → `"gemini"` と完全一致
      - `"gemini-1.5-pro"` → トークン: `["gemini", "1", "5", "pro"]` → `"gemini"` で始まる
      - `"claude-v2"` → トークン: `["claude", "v2"]` → `"claude"` と完全一致
      - `"CLAUDE-3-OPUS"` → トークン: `["claude", "3", "opus"]` → `"claude"` と完全一致
      - `"gemini_flash"` → トークン: `["gemini", "flash"]` → `"gemini"` と完全一致
    - ❌ OpenAI にルーティング (Antigravity 条件に不一致):
      - `"progemini"` → トークン: `["progemini"]` → `"gemini"` で始まらない、完全一致しない
      - `"gpt-4"` → トークン: `["gpt", "4"]` → どちらの条件も満たさない
      - `"text-davinci-003"` → トークン: `["text", "davinci", "003"]` → どちらの条件も満たさない
      - `"my-claude-model"` → トークン: `["my", "claude", "model"]` → `"claude"` と完全一致するトークンが存在 → **実際は Antigravity にルーティング**
  - _Requirements: 2.1, 2.2_

- [ ] 3.2 Router レイヤーに分岐ロジックを統合
  - `POST /v1/chat/completions` ハンドラーに分岐ロジックを追加
  - エイリアス解決（`ModelRoutingService`）後にルーティング判定を実行
  - `model` フィールドの厳密なバリデーションを実装（欠損、null、空文字列を検出）
  - `model` フィールドが不正な場合、要件通りのエラーメッセージとステータス 400 を返却
  - OpenAI ルート選択時に `OpenAIPassthroughService` が未設定の場合は内部エラーを返却
  - OpenAI ルート選択時に API キーが未設定の場合は 401 エラーを返却
  - Antigravity ルートは既存の `TransformService` フローを維持
  - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.2, 5.3_

- [ ] 4. サービス初期化とワイアリング
- [ ] 4.1 main.ts のサービス初期化処理を拡張
  - `createAppContext` に設定サービスの初期化を追加
  - 設定サービスを依存性として OpenAI パススルーサービスに注入
  - `CreateProxyAppOptions` に `openaiService` オプションを追加
  - `AppContext` に新規サービスを追加
  - 設定状態に応じたログ出力を実装（INFO/DEBUG レベル）
  - _Requirements: 1.1, 1.2, 1.3, 5.3_

- [ ] 5. テストの実装
- [ ] 5.1 ユニットテストの実装
  - モデル名判定ロジックのテスト（各パターンで正しい振り分けを確認）
  - 設定サービスのテスト（環境変数設定/未設定時の動作を確認）
  - エラーレスポンス生成ヘルパーのテスト（OpenAI 互換形式の正確性を確認）
  - ヘッダー処理ロジックのテスト（Authorization 上書き、Host 除外、その他保持を確認）
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.2, 4.1, 4.2, 4.3, 4.4_

- [ ] 5.2 統合テストの実装
  - Antigravity ルートのテスト（gemini/claude モデルが TransformService に流れることを確認）
  - OpenAI ルートのテスト（gpt モデルが OpenAIPassthroughService に流れることを確認）
  - API キー未設定時の 401 エラーレスポンスを確認
  - 既存機能の回帰テスト（ModelRoutingService によるエイリアス解決が維持されることを確認）
  - _Requirements: 2.1, 2.2, 1.2, 5.1, 5.2, 5.3_

- [ ] 5.3 E2E テストの実装（`RUN_E2E=1` で有効化）
  - **明示的オプトイン**: `RUN_E2E=1` 環境変数が設定されている場合のみ実行（デフォルトはスキップ）
  - **安全な API キー管理**:
    - **テスト専用の限定権限 API キーを使用** (本番キーを絶対使用しない)
    - API キーは環境変数 `OPENAI_API_KEY_TEST` から取得
    - CI 環境ではシークレットマネージャ（例: Bitbucket Pipelines の Repository variables）から取得
    - CI ではシークレットを **protected variables** に設定し、特定ブランチ（main, develop）のみアクセス可能に設定
  - **ログの安全性**:
    - テストログ出力時に API キーを自動マスキング
    - ロギング関数でキーパターン（`sk-` で始まる文字列）を検出し `***MASKED***` に置換
    - 詳細は「[E2E テストの安全な実行ガイドライン](#e2e-テストの安全な実行ガイドライン)」セクションを参照
  - **テストケース**:
    - 実際の OpenAI API へのリクエスト/レスポンステスト
    - ストリーミング応答の透過中継テスト（SSE ストリームの完全性を確認）
    - ストリーム開始前のタイムアウトエラー検出テスト
    - 無効な API キーでの 401 パススルーテスト
    - ネットワークタイムアウトでの 504 エラーテスト
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2_

---

## 要件カバレッジマトリックス

| 要件 ID | 概要 | 対応タスク |
|---------|------|-----------|
| 1.1 | 環境変数 `OPENAI_API_KEY` の使用 | 1.1, 4.1, 5.1 |
| 1.2 | API キー未設定時の 401 エラー | 1.1, 2.4, 3.2, 5.1, 5.2 |
| 1.3 | クライアントに API キーを要求しない | 1.1, 4.1, 5.1 |
| 2.1 | gemini/claude モデルは Antigravity へ | 3.1, 3.2, 5.1, 5.2 |
| 2.2 | その他のモデルは OpenAI へ | 3.1, 3.2, 5.1, 5.2 |
| 2.3 | model フィールド欠損時の 400 エラー | 3.2, 5.1 |
| 3.1 | スキーマ変換なしで転送 | 2.1, 5.3 |
| 3.2 | ヘッダー処理（Authorization 上書き、その他保持） | 2.2, 5.1, 5.3 |
| 3.3 | ストリーミング応答の逐次中継 | 2.3, 5.3 |
| 3.4 | OpenAI からのレスポンスをそのまま返却 | 2.1, 5.3 |
| 4.1 | 上流エラーの透過的な返却 | 2.4, 5.3 |
| 4.2 | ネットワークエラー時の 504 エラー | 2.4, 5.1, 5.3 |
| 4.3 | 内部エラー時の 500 エラー | 2.4, 5.1 |
| 4.4 | **不完全な応答時の正規化エラー** (詳細: [不完全な応答の検出基準と正規化エラー定義](#不完全な応答の検出基準と正規化エラー定義)) | 2.4, 5.1 |
| 5.1 | `/v1/chat/completions` エンドポイントの維持 | 3.2, 5.2 |
| 5.2 | モデル名に応じた自動経路選択 | 3.1, 3.2, 5.2 |
| 5.3 | 追加設定不要 | 3.2, 1.2, 5.2 |

---

## 実装の優先順位

1. **フェーズ 1: 基盤構築** (タスク 1, 2.1, 2.2)
   - 設定管理とOpenAI API通信の基礎を確立

2. **フェーズ 2: コア機能** (タスク 2.3, 2.4, 3.1, 3.2)
   - ストリーミング、エラーハンドリング、ルーティングロジックを実装

3. **フェーズ 3: 統合** (タスク 4.1)
   - サービス初期化と依存性注入の完成

4. **フェーズ 4: 検証** (タスク 5.1, 5.2, 5.3)
   - 包括的なテストによる品質保証

---

## 不完全な応答の検出基準と正規化エラー定義

このセクションでは、OpenAI API からの「不完全な応答」を検出するための明確な基準、各ケースに対する正規化エラーレスポンス形式、および実装時の検出ロジックを定義します。

### 検出基準一覧

#### 1. **切り捨てられた/部分的な JSON パースエラー**

**検出基準**:
- 非ストリーミングレスポンス (Content-Type: `application/json`) で `response.json()` がパースエラーを投げる
- JSON 文字列が途中で終わっている（例: `{"choices":[{"message":{"role":"assistant","con`）
- JSON として不正な文字列が含まれる（例: 制御文字、エスケープされていない引用符）

**検出ロジック**:
```typescript
try {
  const data = await response.json();
} catch (error) {
  // SyntaxError の場合、部分的 JSON と判定
  if (error instanceof SyntaxError) {
    // エラーレスポンスを生成
  }
}
```

**正規化エラーレスポンス**:
```json
{
  "error": {
    "message": "Received incomplete or malformed JSON response from OpenAI API",
    "type": "incomplete_response",
    "code": "json_parse_error",
    "param": null,
    "diagnostics": {
      "parseError": "Unexpected end of JSON input at position 145",
      "bytesReceived": 145,
      "rawSnippet": "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"con"
    }
  }
}
```

**ステータスコード**: `502 Bad Gateway`

**リトライ**: なし（クライアントに即座に返却）

---

#### 2. **予期された終了前のストリーム終了**

**検出基準**:
- SSE ストリーミングレスポンスで `[DONE]` イベントを受信する前に接続が切断される
- `ReadableStream` の `reader.read()` が `done: true` を返すが、最後のイベントが `data: [DONE]` ではない
- ストリーム途中で HTTP 接続が突然クローズされる

**検出ロジック**:
```typescript
let lastEventTimestamp = Date.now();
let receivedDoneEvent = false;

while (true) {
  const { done, value } = await reader.read();
  if (done) {
    if (!receivedDoneEvent) {
      // 不完全なストリーム終了を検出
    }
    break;
  }

  const chunk = decoder.decode(value);
  if (chunk.includes('data: [DONE]')) {
    receivedDoneEvent = true;
  }
  lastEventTimestamp = Date.now();
}
```

**正規化エラーレスポンス**:
```json
{
  "error": {
    "message": "OpenAI API stream terminated unexpectedly before completion marker",
    "type": "incomplete_response",
    "code": "stream_truncated",
    "param": null,
    "diagnostics": {
      "lastChunkTimestamp": 1704067200000,
      "receivedDoneEvent": false,
      "bytesReceived": 4096,
      "rawSnippet": "data: {\"choices\":[{\"delta\":{\"content\":\"world\"},\"index\":0}]}"
    }
  }
}
```

**ステータスコード**: `502 Bad Gateway`

**リトライ**: なし（クライアントに即座に返却）

---

#### 3. **Content-Length ミスマッチ**

**検出基準**:
- レスポンスヘッダーに `Content-Length` が存在する
- 実際に受信したバイト数が `Content-Length` と一致しない

**検出ロジック**:
```typescript
const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
if (contentLength > 0) {
  let bytesReceived = 0;
  const reader = response.body!.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesReceived += value.length;
  }

  if (bytesReceived !== contentLength) {
    // Content-Length ミスマッチを検出
  }
}
```

**正規化エラーレスポンス**:
```json
{
  "error": {
    "message": "Response size mismatch: received fewer bytes than Content-Length header indicated",
    "type": "incomplete_response",
    "code": "content_length_mismatch",
    "param": null,
    "diagnostics": {
      "expectedLength": 8192,
      "bytesReceived": 4096,
      "rawSnippet": null
    }
  }
}
```

**ステータスコード**: `502 Bad Gateway`

**リトライ**: なし（クライアントに即座に返却）

---

#### 4. **必須フィールドの欠損**

**検出基準**:
- 非ストリーミングレスポンスで JSON パースは成功するが、OpenAI API の必須フィールドが存在しない
- 必須フィールド: `id`, `object`, `created`, `model`, `choices`
- `choices` 配列が空、または各 choice に `message` または `delta` が存在しない

**検出ロジック**:
```typescript
const data = await response.json();

// 必須フィールドのチェック
const requiredFields = ['id', 'object', 'created', 'model', 'choices'];
const missingFields = requiredFields.filter(field => !(field in data));

if (missingFields.length > 0) {
  // 必須フィールド欠損を検出
}

// choices 配列の検証
if (!Array.isArray(data.choices) || data.choices.length === 0) {
  // 空または不正な choices 配列を検出
}
```

**正規化エラーレスポンス**:
```json
{
  "error": {
    "message": "OpenAI API response missing required fields: id, choices",
    "type": "incomplete_response",
    "code": "missing_required_fields",
    "param": null,
    "diagnostics": {
      "missingFields": ["id", "choices"],
      "bytesReceived": 256,
      "rawSnippet": "{\"object\":\"chat.completion\",\"created\":1704067200,\"model\":\"gpt-4\"}"
    }
  }
}
```

**ステータスコード**: `502 Bad Gateway`

**リトライ**: なし（クライアントに即座に返却）

---

#### 5. **SSE プロトコル/フレームエラー**

**検出基準**:
- SSE イベントストリームが不正な形式を含む
- `data:` プレフィックスなしの行が存在する（空行とコメント行 `:` を除く）
- SSE イベント内の JSON が不正（各 `data:` 行の JSON パースエラー）

**検出ロジック**:
```typescript
const lines = chunk.split('\n');
for (const line of lines) {
  if (line.trim() === '' || line.startsWith(':')) {
    continue; // 空行とコメントは無視
  }

  if (line.startsWith('data:')) {
    const jsonStr = line.slice(5).trim();
    if (jsonStr === '[DONE]') {
      receivedDoneEvent = true;
      continue;
    }

    try {
      JSON.parse(jsonStr);
    } catch (error) {
      // SSE フレーム内の JSON パースエラーを検出
    }
  } else {
    // 不正な SSE 形式を検出
  }
}
```

**正規化エラーレスポンス**:
```json
{
  "error": {
    "message": "OpenAI API returned malformed SSE stream: invalid JSON in data frame",
    "type": "incomplete_response",
    "code": "sse_protocol_error",
    "param": null,
    "diagnostics": {
      "parseError": "Unexpected token } in JSON at position 42",
      "lastChunkTimestamp": 1704067200000,
      "bytesReceived": 2048,
      "rawSnippet": "data: {\"choices\":[{\"delta\":{\"content\":\"test\"},}]}"
    }
  }
}
```

**ステータスコード**: `502 Bad Gateway`

**リトライ**: なし（クライアントに即座に返却）

---

### 検出基準の適用優先順位

1. **HTTP ステータスチェック** (タスク 2.3): `status !== 200` の場合、他のチェックをスキップ
2. **Content-Length ミスマッチ** (基準 3): レスポンスボディ読み込み中に検出
3. **JSON パースエラー** (基準 1): 非ストリーミングレスポンスの場合
4. **必須フィールド欠損** (基準 4): JSON パース成功後にチェック
5. **SSE プロトコルエラー** (基準 5): ストリーミングレスポンスの各チャンクで検出
6. **ストリーム終了前の切断** (基準 2): ストリーム完了時にチェック

---

### 実装時の共通ガイドライン

- **タイムアウト閾値**: 接続タイムアウト (10 秒)、アイドルタイムアウト (30 秒) を適用
- **リトライ戦略**: すべての不完全応答エラーはリトライせず、クライアントに即座に返却
- **ログ記録**: すべての不完全応答エラーを `ERROR` レベルでログ出力し、`diagnostics` フィールドを含める
- **診断情報の制限**: `rawSnippet` は最大 200 文字に制限し、機密情報を含まないようにする
- **エラー形式の統一**: すべてのエラーレスポンスは OpenAI 互換形式 (`error.message`, `error.type`, `error.code`, `error.param`, `diagnostics`) を使用

---

## 技術的な注意事項

### 既存コンポーネントとの連携
- `ModelRoutingService`: エイリアス解決は既存フローを維持
- `TransformService`: Antigravity ルートは既存の変換処理を使用
- `proxy-router.ts`: 分岐ロジックを追加、既存フローへの影響を最小化

### パフォーマンス目標
- 追加レイテンシ: < 50ms
- ストリーミング時のメモリ使用量: 一定（バッファリングなし）

### セキュリティ
- **API キーのログ出力時マスク処理**:
  - すべてのログ出力で `sk-` で始まる文字列を `***MASKED***` に自動置換
  - ロギング関数に共通のマスキングロジックを実装
  - 実装場所: `src/utils/logger.ts` または各ログ出力箇所
- **クライアントの `Authorization` ヘッダーを無視（上書き）**:
  - クライアントから送信された Authorization ヘッダーは破棄
  - サーバー側で管理する API キーのみを使用
- **レスポンスへの API キー露出防止**:
  - エラーレスポンスやデバッグ情報に API キーを含めない
  - `diagnostics` フィールドにもキー情報を含めない
- **E2E テストでの安全性**:
  - 詳細は「[E2E テストの安全な実行ガイドライン](#e2e-テストの安全な実行ガイドライン)」セクションを参照
  - テスト専用の限定権限キーを使用
  - CI ではシークレット保護機能を活用

---

## E2E テストの安全な実行ガイドライン

このセクションでは、実際の OpenAI API を使用する E2E テストを安全に実行するための手順、API キー管理、ログマスキング、CI 設定について説明します。

### 1. 明示的オプトイン

E2E テストは **明示的にオプトインした場合のみ実行** されます:

```bash
# E2E テストをスキップ（デフォルト）
npm test

# E2E テストを実行
RUN_E2E=1 npm test
```

テストフレームワーク内で環境変数をチェックし、`RUN_E2E=1` が設定されていない場合は E2E テストをスキップします。

```typescript
// 例: Jest での実装
describe('E2E Tests', () => {
  beforeAll(() => {
    if (process.env.RUN_E2E !== '1') {
      console.log('Skipping E2E tests (set RUN_E2E=1 to run)');
      return;
    }
  });

  it.skipIf(process.env.RUN_E2E !== '1')('should call OpenAI API', async () => {
    // テスト実装
  });
});
```

---

### 2. テスト専用 API キーの発行とローテーション

#### 2.1 API キーの発行手順

1. OpenAI Platform ([https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)) にアクセス
2. **テスト専用プロジェクト** を作成 (例: `codex-antigravity-adapter-test`)
3. 新しい API キーを作成し、以下の設定を適用:
   - **名前**: `E2E Test Key - codex-antigravity-adapter`
   - **権限**: **限定的な権限** (例: `gpt-3.5-turbo` のみアクセス可能、レート制限を最小に設定)
   - **使用制限**: 月額使用量上限を設定 (例: $5)
4. 生成されたキーを安全に保存（次のセクションを参照）

#### 2.2 API キーのローテーション手順

- **ローテーション頻度**: 最低でも 90 日ごと、または漏洩が疑われる場合は即座に
- **ローテーション手順**:
  1. 新しいテスト用 API キーを発行
  2. CI/CD および開発環境のシークレットを更新
  3. 古いキーを無効化
  4. チームに通知

---

### 3. API キーの安全な管理

#### 3.1 ローカル開発環境

環境変数を使用してキーを管理:

```bash
# .env.test ファイル（.gitignore に追加必須）
OPENAI_API_KEY_TEST=sk-test-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**重要**: `.env.test` ファイルを `.gitignore` に追加し、Git リポジトリにコミットしない:

```text
# .gitignore
.env
.env.test
.env.*.local
```

#### 3.2 CI/CD 環境（Bitbucket Pipelines）

##### 3.2.1 リポジトリ変数の設定

1. Bitbucket リポジトリの **Settings > Repository variables** にアクセス
2. 新しい変数を追加:
   - **Name**: `OPENAI_API_KEY_TEST`
   - **Value**: `sk-test-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - **Secured**: ✅ チェック（ログに表示されない）
   - **Protected**: ✅ チェック（特定ブランチのみアクセス可能）

##### 3.2.2 Protected Variables の設定

Protected variables は特定のブランチでのみアクセス可能:

1. Bitbucket リポジトリの **Settings > Repository variables** で変数を選択
2. **Restrict to specific branches** を有効化
3. 許可するブランチを指定:
   - `main`
   - `develop`
   - `feature/openai-passthrough*` (必要に応じて)

##### 3.2.3 CI 設定例

```yaml
# bitbucket-pipelines.yml
pipelines:
  branches:
    main:
      - step:
          name: Run E2E Tests
          script:
            - npm install
            - RUN_E2E=1 OPENAI_API_KEY_TEST=$OPENAI_API_KEY_TEST npm test
          # シークレットは自動的にマスクされる
```

**注意**: Bitbucket Pipelines は Secured 変数を自動的にログでマスクしますが、追加のマスキングロジックも実装します（次のセクション）。

---

### 4. ログマスキングの実装

#### 4.1 マスキングの実装場所

API キーを自動的にマスクするロジックを以下の場所に実装:

1. **ロギング関数** (`src/utils/logger.ts`):
   - すべてのログ出力を通るエントリーポイント
   - `console.log`, `console.error` などをラップした共通ロガーを使用

2. **テストログ出力**:
   - Jest のカスタムレポーターまたはセットアップファイルでマスキングロジックを適用

#### 4.2 マスキングロジックの実装例

```typescript
// src/utils/logger.ts

/**
 * API キーをマスクする正規表現
 * OpenAI キーは "sk-" で始まる
 */
const API_KEY_PATTERN = /sk-[a-zA-Z0-9]{20,}/g;

/**
 * ログメッセージ内の API キーをマスクする
 */
function maskApiKeys(message: string): string {
  return message.replace(API_KEY_PATTERN, '***MASKED***');
}

/**
 * 安全なロガー
 */
export const logger = {
  info(message: string, ...args: any[]) {
    console.log(maskApiKeys(message), ...args.map(arg =>
      typeof arg === 'string' ? maskApiKeys(arg) : arg
    ));
  },
  error(message: string, ...args: any[]) {
    console.error(maskApiKeys(message), ...args.map(arg =>
      typeof arg === 'string' ? maskApiKeys(arg) : arg
    ));
  },
  // 他のログレベルも同様に実装
};
```

#### 4.3 テストでの使用例

```typescript
// tests/e2e/openai-passthrough.test.ts

import { logger } from '../../src/utils/logger';

describe('OpenAI Passthrough E2E', () => {
  it('should mask API keys in logs', () => {
    const apiKey = process.env.OPENAI_API_KEY_TEST;
    logger.info(`Using API key: ${apiKey}`);
    // ログ出力: "Using API key: ***MASKED***"
  });
});
```

---

### 5. CI 設定の完全な例

```yaml
# bitbucket-pipelines.yml

image: node:20

definitions:
  steps:
    - step: &unit-tests
        name: Unit Tests
        caches:
          - node
        script:
          - npm install
          - npm run test:unit

    - step: &e2e-tests
        name: E2E Tests (with OpenAI API)
        caches:
          - node
        script:
          - npm install
          # E2E テストを実行（OPENAI_API_KEY_TEST は protected variable）
          - RUN_E2E=1 OPENAI_API_KEY_TEST=$OPENAI_API_KEY_TEST npm run test:e2e

pipelines:
  default:
    - step: *unit-tests

  branches:
    main:
      - step: *unit-tests
      - step: *e2e-tests

    develop:
      - step: *unit-tests
      - step: *e2e-tests

  pull-requests:
    '**':
      - step: *unit-tests
      # Pull Request では E2E テストをスキップ（protected variable にアクセスできない）
```

---

### 6. セキュリティチェックリスト

E2E テストを実装・実行する前に、以下を確認してください:

- [ ] テスト専用の限定権限 API キーを発行した
- [ ] API キーに使用制限（月額上限、レート制限）を設定した
- [ ] `.env.test` ファイルを `.gitignore` に追加した
- [ ] CI/CD で `OPENAI_API_KEY_TEST` を Secured かつ Protected 変数として設定した
- [ ] Protected 変数のブランチ制限を設定した（`main`, `develop` のみ）
- [ ] ログマスキングロジックを `src/utils/logger.ts` に実装した
- [ ] すべてのログ出力で共通ロガーを使用するようにコードを更新した
- [ ] テスト実行時に API キーがログに表示されないことを確認した
- [ ] API キーのローテーション計画を文書化した

---

### 7. トラブルシューティング

#### Q1: E2E テストが失敗する（401 Unauthorized）

- `OPENAI_API_KEY_TEST` 環境変数が正しく設定されているか確認
- API キーが有効期限内であるか確認
- API キーに必要な権限があるか確認

#### Q2: CI でシークレットが露出している

- Bitbucket Pipelines の変数設定で **Secured** がチェックされているか確認
- ログマスキングロジックが正しく実装されているか確認
- `maskApiKeys` 関数が正しく動作しているかユニットテストで確認

#### Q3: Protected 変数にアクセスできない

- CI 実行中のブランチが Protected 変数の許可リストに含まれているか確認
- Pull Request からの実行の場合、E2E テストはスキップされる仕様（意図通り）
