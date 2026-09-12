# 実行用ヘルプとDiscord出力

## 実行用ヘルプ

利用者向けヘルプは`content/help/<command>.txt`へBOM付きUTF-8で置く。`registry.ts`は静的・動的コマンドを`withCommandHelp`で包み、第一引数が`help`ならコマンド本体を実行せず対応ファイルを読む。静的コマンドはhelpファイルがない場合に返信本文へフォールバックする。`o.help`は`content/help/index.txt`を読む。

`help/data-source.ts`はコマンド実行のたびに`process.cwd()/content/help`からファイルを読むため、ローカル実行中でもTypeScriptの再ビルドなしで文面変更が反映される。BOMは読み込み時に除去する。ファイル名へ利用できる文字を制限し、読み込み失敗の詳細はログだけへ記録する。

現在は`index`、全静的コマンド、`sale`、`gatya`、`item`、`ut`のテキストを配置している。requirementsは仕様の正本、helpテキストは利用者向け表示であり、helpから仕様を変更しない。

## Discord出力抽象

`CommandContext.interactive`はDiscord.js型をコマンドへ渡さず、次の操作だけを公開する。

- 本文メッセージ送信
- `Uint8Array`と元ファイル名による添付送信
- 送信済み本文の編集
- リアクション付与
- 全リアクション削除
- 実行者IDと有効絵文字で絞ったリアクション待機

Discord.jsへの変換は`src/discord/message-handler.ts`に閉じ込める。添付は本文を付けず`files`だけで送信でき、全リアクション削除は`message.reactions.removeAll()`を使う。

`sale`、`gatya`、`item`、`ut`の通常検索・originは外部取得完了後に結果またはエラーだけを送る。`ut motion`だけは生成開始時の本文を既存の`edit`で進行度・完了・エラーへ更新する。`ut/motion-progress.ts`が更新間隔を制御し、編集中の通知は最新の一つへ集約する。編集エラーはログだけに記録し、添付生成・送信を妨げない。出力抽象に操作は追加せず、送信済みメッセージ削除操作も引き続き設けない。

## 検証

`tests/commands.test.js`で全helpファイルのBOM、`o.help`、`o.ping help`の実行時読み込みを確認する。ut固有の添付・リアクション編集順は`tests/ut.test.js`で確認する。
