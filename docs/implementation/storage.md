# GitHub保存基盤

## 保存先と初期化

正本は非公開リポジトリ sinsuirakv0/KBC-rakv0-discord-bot-data の main。
GITHUB_DATA_OWNER / GITHUB_DATA_REPO / GITHUB_DATA_BRANCH / GITHUB_DATA_TOKEN で指定する。
本番用には対象repoだけを選んだfine-grained PATのContents読み書き権限を使い、NorthflankのSecretに設定する。Tokenをデータrepoへ保存しない。

npm run storage:init が明示的にmeta.jsonを初期化し、設定復元まで確認する。
通常起動ではmetaがない場合に自動作成しない。repo・branch・認証の404、JSON破損、未知schemaを空設定として上書きしない。

## 関数と関係

- GitHubDataRepository: 非公開repoとbranchを検証。Contents APIのread/list/writeを担当。writeはSHA照合、直列化、最低1秒間隔。PUT応答消失はリモート本文一致を確認できた場合のみ成功。競合時に新しいSHAで古い本文を再送しない。403/429はRetry-After等に従って待機する。
- JsonStore.initialize: metaを検証。read/updateはJSON検証を行い、updateは最新データを取得し、保存確認後に結果を返す。同一内容なら保存しない。
- GuildSettingsStore.restore: config/guilds/<guildId>.jsonを全て検証後、メモリを置き換える。setSubscriptionとsetHealthMaintainerRoleは同じguild文書の他設定を保ち、保存後にキャッシュを更新する。
- NotificationStore.update: eventIdのSHA256をファイル名としたnotifications/events/<hash>.jsonを更新。イベント単位に保存し、全履歴を毎回書き直さない。
- initializeStorage/startStorage: metaとguild設定の復元後にready。失敗時は30秒以上の間隔で再試行し、他コマンドを停止しない。イベント履歴は受信時に正本から読み込む。
- config/administrators.ts: 固定管理者IDと判定関数。権限コマンドへの接続は後続作業。

設定schemaVersion=1にはguildId、healthMaintainerRoleId、subscriptionsを保持する。イベントschemaVersion=1にはeventとdeliveriesを保持する。SHAを更新競合の検出に使う。

## 配送と復旧

createDetectionServiceはイベントを保存し、各配送のpendingをattemptingへ保存してからDiscordへ送る。投稿IDと本文をsentとして保存し、以後は同じIDを編集する。保存失敗は成功扱いにしない。

messageIdのないattemptingは結果不明。再受信時は409 reconciliation-requiredを返し、自動再投稿しない。最初の送信例外は503だが、以後は記録に基づき保留する。編集失敗は同じ投稿への再編集で復旧する。解除済み通知先を除外し、途中で追加した通知先へは遡及しない。

復旧はBotを停止してDiscordの実投稿を確認し、確認できたmessageId・本文とstatus=sentを採用する。未送信を確認した場合だけpendingへ戻す。確認できなければ保留を継続する。専用の復旧コマンドは未実装。

## 運用上の条件

1プロセスだけが書き込む。旧・新デプロイの重複稼働を避ける。SHAは分散ロックではない。
稼働中のGitHub直接編集は対象外。編集後は再起動して設定キャッシュを復元する。
GET /health/liveはプロセス生存、GET /healthはDiscord接続と起動時の保存復元完了を示す。起動後のGitHub障害は各操作が503等で失敗する。
1文書256 KiB、設定ディレクトリ1000件未満。超過を切り捨てない。履歴整理と自動再送の期限は未実装。
送信元Actionsの別runへ持ち越す永続outboxは未実装で、この基盤だけでは別runの通知欠落を解決しない。

## 検証

tests/storage.test.jsで認証・初期化・破損・競合・応答消失・rate limitを確認する。
tests/push.test.jsで設定復元、同じeventIdの重複防止、結果不明の再起動後保留、カテゴリ独立性を確認する。
実GitHubでは専用repoを作成し、metaの書き込みと読み戻し・設定ディレクトリ取得を確認した。本番NorthflankのSecret接続・デプロイは別途確認が必要。
