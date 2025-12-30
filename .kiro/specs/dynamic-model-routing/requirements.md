# 要件定義書

## イントロダクション
本書は、Codex Antigravity Adapter における動的モデルルーティング機能の要件を定義する。機能は受信したチャット補完リクエストを検査し、最新のユーザーメッセージ先頭にあるエイリアスタグ（例: `@fast`）を検出して設定済みのターゲットモデルIDへ解決し、エイリアスタグを除去したうえで当該モデルへルーティングする。

## 要件

### Requirement 1: エイリアス設定の読み込み
**目的:** システム管理者として、クライアント設定を変更せずにルーティング用ショートカットを管理できるようにしたい。

#### 受入基準
1. When アダプタが起動したとき, the Dynamic Model Routing Middleware shall プロジェクトルートの `model-aliases.json` からエイリアス定義を読み込むこと。
2. If `model-aliases.json` が存在しない場合, the Dynamic Model Routing Middleware shall 空のエイリアスマップで動作を継続し、情報ログを記録すること。
3. If `model-aliases.json` に無効なJSONが含まれる場合, the Dynamic Model Routing Middleware shall 当該ファイルを無視し、空のエイリアスマップを使用して警告ログを記録すること。
4. The Dynamic Model Routing Middleware shall JSONオブジェクトのキーをモデルエイリアスタグ、値をターゲットモデルIDとして扱うこと。

### Requirement 2: ユーザーメッセージのエイリアス検出
**目的:** 開発者として、プロンプト先頭のエイリアスタグでモデルを素早く選択できるようにしたい。

#### 受入基準
1. When チャット補完リクエストを受信したとき, the Dynamic Model Routing Middleware shall 最新のユーザーメッセージの内容を検査すること。
2. If ユーザーメッセージが存在しない場合, the Dynamic Model Routing Middleware shall リクエストを変更せずに転送すること。
3. When ユーザーメッセージ内容が設定済みエイリアスタグで始まり、直後が空白または内容終端である場合, the Dynamic Model Routing Middleware shall 当該エイリアスを検出すること。
4. The Dynamic Model Routing Middleware shall スキーマ検証後の文字列形式コンテンツに対してエイリアス検出を実行すること（配列形式は既存スキーマにより文字列に変換済み）。

### Requirement 3: モデルルーティングの決定
**目的:** 開発者として、検出したエイリアスでリクエストのモデルを切り替えられるようにしたい。

#### 受入基準
1. When 設定済みエイリアスが検出された場合, the Dynamic Model Routing Middleware shall リクエストの `model` を対応するターゲットモデルIDに置き換えること。
2. If 検出したエイリアスが設定に存在しない場合, the Dynamic Model Routing Middleware shall 元の `model` 値を保持すること。
3. When モデルルーティングが行われた場合, the Dynamic Model Routing Middleware shall 元のモデル、エイリアス、ターゲットモデルをデバッグレベルで記録すること。

### Requirement 4: プロンプトのサニタイズ
**目的:** 開発者として、モデルにはルーティング用メタ情報を含まないクリーンな入力を届けたい。

#### 受入基準
1. When エイリアスによるルーティングが適用された場合, the Dynamic Model Routing Middleware shall ユーザーメッセージ内容からエイリアスタグと直後の空白を除去すること。
2. The Dynamic Model Routing Middleware shall エイリアス除去後のユーザーメッセージ内容をそのまま保持すること。
3. If エイリアス除去後にユーザーメッセージ内容が空になった場合, the Dynamic Model Routing Middleware shall 空文字列を保持すること。
4. The Dynamic Model Routing Middleware shall エイリアスを含んだユーザーメッセージのみを変更し、他のメッセージは変更しないこと。

### Requirement 5: パススルー動作とスコープ
**目的:** 開発者として、エイリアスなしのリクエストが従来どおり動作するようにしたい。

#### 受入基準
1. If エイリアスが検出されない場合, the Dynamic Model Routing Middleware shall リクエストを変更せずに転送すること。
2. If ユーザーメッセージ内容が `@` で始まらない場合, the Dynamic Model Routing Middleware shall エイリアス検出をスキップし、リクエストを変更せずに転送すること。
3. The Dynamic Model Routing Middleware shall エイリアス除去対象のユーザーメッセージ内容と `model` 以外のリクエストフィールドを変更しないこと。

### Requirement 6: スコープ制限
**目的:** システムアーキテクトとして、機能のスコープを明確にし、実装をシンプルに保ちたい。

#### 受入基準
1. The Dynamic Model Routing Middleware shall スキーマ検証後の文字列形式コンテンツのみを対象とすること。
2. The Dynamic Model Routing Middleware shall 配列形式の生データ構造の保持をスコープ外とすること（既存スキーマにより文字列に変換済み）。
3. The Dynamic Model Routing Middleware shall 非テキストパート（画像、音声等）の個別処理をスコープ外とすること。
4. The Dynamic Model Routing Middleware shall 既存の `ChatCompletionRequestSchema` の変換ロジックを変更しないこと。
