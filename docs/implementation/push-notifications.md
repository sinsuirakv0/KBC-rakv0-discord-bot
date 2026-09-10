# 検知通知基盤

> 保存先は専用private GitHubリポジトリ。[保存基盤](storage.md)に関数、初期化、復旧手順を記載する。

## 経路と役割

1. eventリポジトリのcheckAndNotifyが種類ごとの取得・保存済みハッシュ確認を終えた直後、Discord用検知通知を送る。他のTSV・JSONの取得やGitHubへの保存を待たない。
2. このBotのnotifications/server.tsが認証付きPOST /event-updateを受信し、parsers.tsで検証する。
3. service.tsのcreateDetectionServiceが通知IDと登録チャンネルを確認し、formatters.tsの文面をdiscord/notification-transport.ts経由で送る。eventdataの取得・解析は行わない。
4. スケジュールのtypes通知では、同じIDの送信済みメッセージを編集する。遅れて届いたdetectedで種類を消さない。typesだけ先に届いた場合も速報を投稿してから編集する。

スケジュールとad・noticeは別ID・別登録先として処理する。同じイベントの処理だけ直列化し、別イベントと別チャンネルへの送信は並行できる。GitHub更新は共通キューで直列化する。

## 通信契約

送信先はBOT_EVENT_UPDATE_URL、送信側SecretはBOT_EVENT_UPDATE_SECRET。受信側EVENT_UPDATE_SECRETと同じ値を設定する。HTTP headerはx-event-update-secret。公開時はHTTPSのリバースプロキシ等を通す。

```json
{"version":1,"eventId":"event:123:skd","category":"skd","phase":"detected","detectedAt":"2026-09-05T15:00:00.000Z","types":[]}
```

同じeventIdでphase=types、types=["gatya","sale"]を送ると追記する。順序はgatya,sale,itemに正規化し、既受信分との和集合を使う。categoryはskd/ad/notice、ad/noticeはphase=detectedと空のtypesだけを受け付ける。categoryを通知IDの途中で変える要求は拒否する。

受信HTTP 200は送信・編集と保存済み状態の更新完了を示す。配送や保存の失敗は503で、送信側は同じIDで再試行できる。認証不一致401、不正データ400、非JSON415、本文上限16 KiB超過413。Secret未設定なら受信サーバーを起動しない。GET /healthはDiscord接続と保存復元状態、GET /health/liveは生存状態を返す。結果不明の再受信は409 reconciliation-required。

送信側は1回のActions runにつきスケジュール通知を1つにまとめる。run内で種類が増えたら追記する。ad/noticeは種類とハッシュごとに識別する。Actionsの再実行でもGITHUB_RUN_IDが同じならIDを再利用する。別run間は監視側の直列化と保存済みハッシュ確認で通常の重複を防ぐ。

## 保存と再送

NotificationStoreはGitHubへイベント単位で保存する。送信前にattemptingを確定し、送信後にmessageIdと本文をsentとして確定する。結果不明のattemptingは新規投稿せず保留する。復旧・制限・初期化は[保存基盤](storage.md)を参照。

## コマンドと権限

commands/push/parsers.tsが種類とoffを解析し、command.tsがcanConfigureを確認してNotificationStore.setSubscriptionを呼ぶ。登録先はコマンド実行チャンネル。Guild限定で、CommandContextのguildId/channelId/userIdをDiscordアダプターから渡す。

canConfigureは将来の固定Bot管理者・健康維持メンテナー判定を差し込む箇所。現在の本番定義はundefinedを返し、準備中の返信で登録変更を止める。テストではtrue/falseを差し替える。Discord標準の管理権限を仮の代替として使わない。

## 設定・検証

- EVENT_UPDATE_SECRET: 受信認証Secret。
- EVENT_UPDATE_PORT: ポート。未指定ならPORT、さらに未指定なら3000。
- EVENT_UPDATE_HOST: 待受アドレス。既定0.0.0.0。
- GITHUB_DATA_OWNER / REPO / BRANCH / TOKEN: 保存repoと認証（実際の各変数にはGITHUB_DATA_を付ける）。

tests/push.test.jsで文面、入力検証、権限保留、登録解除、再送・再起動・順不同の編集、部分配送失敗、通知カテゴリの独立性、HTTP認証と障害応答を確認する。外部Discordへの実投稿は行わない。
