# 実装計画

## 概要
Codex CLI 用 Antigravity Adapter のローカルプロキシを実装する。OAuth 認証フローと OpenAI 互換のチャット補完 API を提供し、opencode-antigravity-auth から移植したリクエスト/レスポンス変換と署名仕様に準拠した動作を実現する。

## タスク一覧

- [x] 1. プロジェクトの基盤とインフラストラクチャのセットアップ
  - Bun 1.x および Hono 4.x を使用したプロジェクトの初期化
  - TypeScript 設定の構成（strict モード、パス解決）
  - 依存関係のインストール（Hono, Zod, テストフレームワーク）
  - ディレクトリ構造の作成（auth, proxy, transformer, config）
  - 開発/ビルドスクリプトの設定
  - _Requirements: 全要件の基盤となるセットアップ_

- [x] 2. 認証ドメインの実装
- [x] 2.1 トークンストレージの実装
  - JSON ファイルベースのトークン永続化機能
  - アトミックな書き込み処理（一時ファイル → fsync → atomic rename）
  - ファイルパーミッション設定（POSIX: 600, Windows: ベストエフォート）
  - トークン有効期限の検証ロジック
  - アクセストークンとリフレッシュトークンのライフサイクル管理
  - projectId の保存と取得機能
  - _Requirements: 2.3_

- [x] 2.2 トークン自動リフレッシュ機能の実装
  - 有効期限 5 分前の自動リフレッシュトリガー
  - 指数バックオフによる再試行戦略（最大 3 回、1 秒 → 2 秒 → 4 秒）
  - Google OAuth トークンエンドポイントへの HTTP リクエスト
  - `refresh_token_expires_in` の保存と検証
  - リフレッシュ失敗時の再認証要求エラー生成
  - トークンファイル削除検知とエラーハンドリング
  - _Requirements: 2.3, 2.4, 2.5_

- [x] 2.3 OAuth 認証サービスの実装
  - PKCE 対応の OAuth 認可 URL 生成機能
  - state パラメータの生成と HMAC 署名付与
  - AuthSessionStore（インメモリ、TTL 5 分）の実装
  - 認可コードからトークンへの交換処理
  - Google OAuth トークンエンドポイントとの通信
  - loadCodeAssist による projectId 解決（prod → daily → autopush の順）
  - フォールバック時の projectId 設定要求エラー生成
  - _Requirements: 2.1, 2.2, 2.4_

- [x] 2.4 認証ルーターとエンドポイントの実装
  - ポート 51121 での Auth Server の起動
  - `/login` エンドポイント（OAuth 認可 URL へリダイレクト）
  - `/oauth-callback` エンドポイント（state 検証、トークン交換、成功/失敗の HTML レスポンス）
  - `/auth/status` エンドポイント（認証状態の確認）
  - HMAC 検証と TTL 判定の実装
  - エラー時の明確なエラーレスポンス生成
  - _Requirements: 1.2, 1.4, 2.1, 2.2, 2.4_

- [ ] 3. プロキシドメインの実装
- [x] 3.1 OpenAI 互換リクエストスキーマの定義と検証
  - Zod スキーマによる ChatCompletionRequest の定義
  - `messages` 配列の検証（system, user, assistant, tool ロール対応）
  - `content` 配列の text 結合処理（`type: "text"` のみ許可）
  - `assistant` ロールの `tool_calls` 検証
  - `tool` ロールの `tool_call_id` 必須検証
  - `tools` と `tool_choice` の検証
  - マルチモーダル要素（image_url 等）の拒否処理
  - `logprobs` の拒否処理
  - `n` パラメータの制約（1 のみ許可）
  - _Requirements: 3.1, 3.2_

- [ ] 3.2 OpenAI 互換ルーターの実装
  - ポート 3000 での Proxy Server の起動
  - `/v1/chat/completions` エンドポイント（POST）
  - Zod スキーマによるリクエストバリデーション
  - バリデーションエラー時の 400 レスポンス生成
  - 未認証時の 401 レスポンスと認証 URL 案内
  - 未対応エンドポイントへの 404 レスポンス
  - `/v1/models` エンドポイント（固定モデル一覧の返却）
  - TransformService への処理委譲
  - _Requirements: 1.1, 1.3, 1.4, 3.1, 3.2_

- [ ] 4. リクエスト変換の実装
- [ ] 4.1 基本的な OpenAI → Gemini 変換の実装
  - `messages` → `contents` スキーマへの変換
  - `system` ロール → `systemInstruction` への変換
  - `user` ロール → `role: "user"` への変換
  - `assistant` ロール → `role: "model"` への変換
  - `content` 配列（text のみ）の結合処理
  - `temperature` と `max_tokens` の変換
  - OpenAI `model` から Antigravity model ID へのマッピング
  - `systemInstruction` の `parts` オブジェクト形式への正規化
  - _Requirements: 4.1, 4.4_

- [ ] 4.2 ツール関連の変換実装
  - `assistant.tool_calls` → `functionCall` への変換
  - `tool` ロール → `functionResponse` への変換
  - `tool_call_id` と `function.name` の対応表の構築
  - `tool` ロールの参照整合性検証
  - `tool_calls.function.arguments` の JSON パース処理
  - Claude モデルでの `tool_call_id` 連番化
  - `tools` 定義のサニタイズ（`const` → `enum`、`$ref`/`$schema`/`$id`/`default`/`examples` 除去）
  - `tool_choice` の `toolConfig` への変換
  - ツール名の制約適用（英数字/`_`/`.`/`:`/`-`、先頭は英字または `_`）
  - 変換不能な `tool_choice` の検出とエラー生成
  - _Requirements: 4.1, 4.4_

- [ ] 4.3 Thinking 互換レイヤーの実装
  - Thinking 対応モデルの判定（`claude` かつ `thinking`/`opus`、または `gemini-3`）
  - thinkingConfig の正規化（デフォルト budget 16000 / include=true）
  - Claude の場合のスネークケース変換（`thinking_budget`/`include_thoughts`）
  - Thinking 有効時の `maxOutputTokens` 強制（64000 以上）
  - Claude thinking かつ tools がある場合の systemInstruction ヒント追記
  - `anthropic-beta: interleaved-thinking-2025-05-14` ヘッダーの付与
  - _Requirements: 4.2_

- [ ] 4.4 署名キャッシュと Strip-then-Inject の実装
  - 署名キャッシュ（インメモリ LRU、最大 512 件、TTL 10 分）の実装
  - `sessionId` の生成（プロセス起動時に固定 ID を生成）
  - 思考ブロックの検出（`type: "thinking"|"redacted_thinking"|"reasoning"` または `signature`/`thoughtSignature`）
  - Strip 処理：`messages` 内の思考ブロック削除（削除前に textHash 算出）
  - Inject 処理：tool 利用時に署名キャッシュから思考ブロックを取得し、`functionCall` 直前に注入
  - キャッシュ参照ロジック（`sessionId + textHash` 優先、fallback はセッション内最新エントリ）
  - 署名キャッシュ欠損時の `SIGNATURE_CACHE_MISS` エラー生成
  - Tool ブロック（functionCall/functionResponse）の保持と変換
  - _Requirements: 4.2, 4.4_

- [ ] 4.5 リクエストエンベロープとヘッダーの構築
  - `project`/`model`/`request`/`userAgent`/`requestId` でラップしたボディの構築
  - `sessionId` の `request.sessionId` への設定
  - 必須ヘッダーの付加（`Authorization`, `User-Agent`, `X-Goog-Api-Client`, `Client-Metadata`）
  - Claude thinking の場合の `anthropic-beta` ヘッダー付与
  - ストリーミング時の `Accept: text/event-stream` ヘッダー付加
  - _Requirements: 4.1, 4.2_

- [ ] 5. レスポンス変換の実装
- [ ] 5.1 基本的な Gemini → OpenAI 変換の実装
  - `candidates[].content.parts[]` → `choices[].message` への変換
  - `role: "model"` → `role: "assistant"` への変換
  - テキストコンテンツの結合処理
  - `finish_reason` のマッピング（`STOP` → `stop`, `MAX_TOKENS` → `length`）
  - `usage` 情報の集計（`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`）
  - レスポンス ID とタイムスタンプの生成
  - _Requirements: 4.3, 4.4_

- [ ] 5.2 ツール関連のレスポンス変換
  - `functionCall` → `tool_calls` への変換
  - `tool_calls` の構造化（id, type, function.name, function.arguments）
  - `function.arguments` の JSON 文字列化
  - _Requirements: 4.3, 4.4_

- [ ] 5.3 SSE ストリーミング変換の実装
  - Antigravity SSE ストリーム（`data: { "response": ... }` 形式）のパース
  - OpenAI 互換 SSE チャンク（`ChatCompletionChunk`）への逐次変換
  - `delta` オブジェクトの構築（role, content, tool_calls の増分）
  - `tool_calls` の streaming 時の分割処理（index, id, type, function.name, function.arguments の差分）
  - ストリーム終了時の `data: [DONE]` 出力
  - エラーチャンクのハンドリングと OpenAI 互換エラー形式への変換
  - _Requirements: 3.4, 4.3_

- [ ] 5.4 署名付き thinking ブロックの検出と保存
  - レスポンス内の思考ブロック検出（`thought: true` / `type: "thinking"` / `signature` / `thoughtSignature`）
  - thinking テキストの SHA-256 ハッシュ算出
  - 署名キャッシュへの保存（`sessionId + textHash` をキーとして）
  - TTL 期限切れエントリの削除処理
  - _Requirements: 4.2, 4.3_

- [ ] 6. Transform Service の統合実装
- [ ] 6.1 トークン管理と API 呼び出しの統合
  - TokenStore からのアクセストークンと projectId の取得
  - トークン有効性の確認と自動リフレッシュの実行
  - トークン不存在時の 401 エラー生成
  - RequestTransformer を使用したリクエスト変換の実行
  - 変換エラー時のエラーレスポンス生成
  - _Requirements: 2.5, 3.3, 4.4_

- [ ] 6.2 Antigravity API との通信実装
  - エンドポイント URL の構築（`daily → autopush → prod` のフォールバック）
  - ストリーミング時のエンドポイント（`:streamGenerateContent?alt=sse`）
  - 非ストリーミング時のエンドポイント（`:generateContent`）
  - Bun fetch を使用した HTTP リクエストの送信
  - レスポンスステータスコードのハンドリング
  - Antigravity API エラーの OpenAI 互換エラーへの変換
  - _Requirements: 3.3, 3.5_

- [ ] 6.3 ストリーミングレスポンスの処理
  - Antigravity SSE ストリームの受信
  - ResponseTransformer を使用したストリーム変換
  - 変換済み SSE ストリームのクライアントへのパイプ処理
  - ストリームエラー時のエラーハンドリング
  - _Requirements: 3.4, 3.5_

- [ ] 6.4 非ストリーミングレスポンスの処理
  - Antigravity JSON レスポンスの受信
  - ResponseTransformer を使用したレスポンス変換
  - OpenAI 互換レスポンスの返却
  - エラーレスポンスの変換と返却
  - _Requirements: 3.4, 3.5_

- [ ] 7. エントリポイントとライフサイクル管理の実装
- [ ] 7.1 サーバー起動とライフサイクル管理
  - Auth Server（ポート 51121）と Proxy Server（ポート 3000）の並行起動
  - 127.0.0.1 でのリッスン設定（ローカルホストのみ）
  - プロセス起動時の初期化処理（署名キャッシュ、sessionId 生成）
  - 環境変数の読み込み（`ANTIGRAVITY_PROJECT_ID` 等）
  - 設定定数の定義（`ANTIGRAVITY_DEFAULT_PROJECT_ID` 等）
  - シグナルハンドリング（SIGINT, SIGTERM）によるグレースフルシャットダウン
  - _Requirements: 1.2, 1.3_

- [ ] 7.2 エラーハンドリングとロギング
  - 全リクエスト/レスポンスのデバッグログ（環境変数で有効化）
  - トークンリフレッシュイベントのログ記録
  - Antigravity API レイテンシの記録
  - エラーカテゴリごとの適切なエラーレスポンス生成（4xx, 5xx）
  - OpenAI 互換エラーオブジェクトの構築
  - _Requirements: 1.4, 2.4, 2.5, 3.2, 3.5, 4.4_

- [ ] 8. テストの実装
- [ ] 8.1 ユニットテストの作成
  - RequestTransformer のテスト（messages 変換、tool 変換、thinking 互換、署名処理、スキーマサニタイズ）
  - ResponseTransformer のテスト（candidates 変換、functionCall 変換、署名保存、SSE チャンク生成）
  - TokenStore のテスト（ファイル読み書き、atomic 書き換え、パーミッション、有効期限判定、リフレッシュロジック）
  - AuthService のテスト（OAuth URL 生成、state 検証、トークン交換、projectId 解決）
  - Zod スキーマのテスト（バリデーションケース、content 結合、tool_calls 許可、マルチモーダル拒否）
  - 署名キャッシュのテスト（保存、取得、LRU エビクション、TTL 期限切れ）
  - _Requirements: 全要件のユニットレベル検証_

- [ ] 8.2 統合テストの作成
  - OAuth フロー統合テスト（state 生成 → コールバック → HMAC/TTL 検証 → トークン保存）
  - Proxy フロー統合テスト（OpenAI リクエスト → Antigravity API モック → OpenAI レスポンス）
  - ツールフロー統合テスト（tool_calls → tool ロール → 再リクエスト → 署名注入 → 成功応答）
  - 未認証時の動作テスト（401 + 認証 URL 案内）
  - SSE ストリーミング統合テスト（チャンク変換とパイプ処理）
  - エラーハンドリング統合テスト（バリデーションエラー、API エラー、ネットワークエラー）
  - _Requirements: 全要件の統合レベル検証_

- [ ] 9. 統合とエンドツーエンドの検証
- [ ] 9.1 コンポーネント統合の検証
  - Auth Domain と Proxy Domain の連携確認
  - TokenStore と TransformService の統合確認
  - RequestTransformer と ResponseTransformer の連携確認
  - 署名キャッシュと Strip-then-Inject の統合確認
  - エラーフロー全体の検証
  - _Requirements: 全要件の統合確認_

- [ ] 9.2 実環境でのエンドツーエンドテスト
  - Codex CLI 設定の構成（`config.toml` に antigravity プロバイダー追加）
  - プロキシの起動と OAuth 認証フローの実行
  - 実際の chat completion リクエストの実行（ストリーミング/非ストリーミング）
  - tool 利用を含むマルチターンの会話フローの実行
  - トークン期限切れ → 自動リフレッシュ → リクエスト成功の確認
  - Claude thinking モデルでの署名ブロック処理の確認
  - エラーケースの実動作確認（未認証、バリデーションエラー、API エラー等）
  - _Requirements: 全要件のエンドツーエンド検証_

## 要件カバレッジマトリクス

| 要件 ID | 要件概要 | 対応タスク |
|---------|----------|-----------|
| 1.1 | HTTP リクエスト受付 | 3.2 |
| 1.2 | OAuth エンドポイント公開 ポート 51121 | 2.4, 7.1 |
| 1.3 | Chat エンドポイント公開 ポート 3000 | 3.2, 7.1 |
| 1.4 | 未対応エンドポイントエラー | 2.4, 3.2, 7.2 |
| 2.1 | OAuth 認可 URL 提示 | 2.3, 2.4 |
| 2.2 | 認可コード→トークン交換 | 2.3, 2.4 |
| 2.3 | トークン保持 | 2.1, 2.2 |
| 2.4 | トークン取得失敗エラー | 2.2, 2.3, 2.4, 7.2 |
| 2.5 | トークン不存在エラー | 2.2, 6.1, 7.2 |
| 3.1 | OpenAI スキーマ検証 | 3.1, 3.2 |
| 3.2 | バリデーションエラー | 3.1, 3.2, 7.2 |
| 3.3 | Antigravity API リクエスト送信 | 6.1, 6.2 |
| 3.4 | OpenAI 互換レスポンス返却 | 5.1, 5.2, 5.3, 6.3, 6.4 |
| 3.5 | Antigravity エラー変換 | 6.2, 6.3, 6.4, 7.2 |
| 4.1 | OpenAI→Gemini 変換 | 4.1, 4.2, 4.5 |
| 4.2 | Thinking 互換レイヤー（署名ブロック処理含む） | 4.3, 4.4, 4.5 |
| 4.3 | Gemini→OpenAI 変換 | 5.1, 5.2, 5.3 |
| 4.4 | 変換エラー | 4.1, 4.2, 4.4, 5.1, 6.1, 7.2 |

## 次のステップ

実装タスクが承認されたら、以下のコマンドで実装を開始できます:

```bash
# すべての未完了タスクを実行
/kiro:spec-impl codex-antigravity-adapter

# 特定のタスクを実行
/kiro:spec-impl codex-antigravity-adapter 1     # タスク 1 のみ
/kiro:spec-impl codex-antigravity-adapter 2.1   # サブタスク 2.1 のみ
/kiro:spec-impl codex-antigravity-adapter 2,3,4 # タスク 2, 3, 4 を実行
```

## 実装時の注意事項

1. **段階的な実装**: タスクは依存関係を考慮した順序で配置されています。上から順に実装することを推奨します。
2. **テスト駆動**: 各機能の実装後、対応するユニットテストを作成してください。
3. **コミット戦略**: 各メジャータスク（1, 2, 3, ...）の完了時にコミットを作成することを推奨します。
4. **エラーハンドリング**: すべてのエラーケースで OpenAI 互換のエラーオブジェクトを返却してください。
5. **セキュリティ**: トークンファイルのパーミッション設定とアトミックな書き込み処理を必ず実装してください。
6. **署名キャッシュ**: Claude thinking + tool 利用時の署名ブロック処理は慎重に実装してください。
