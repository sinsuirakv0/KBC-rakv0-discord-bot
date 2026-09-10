# skd詳細通知の実装

## データと表示

src/notifications/skd/parsersの3ファイルはKBC-rakv0-eventのparsersから同梱したもの。元パーサー最終変更はe839f3cf8bc9f4a7f48f0b6e90390b5b57823313。実行時に外部JavaScriptを評価せず、allowJsでビルド時に取り込む。更新時は取得側パーサーとの整合を確認する。

createScheduleDetailsBuilderはreadyイベントのbeforeRefからdata/<type>.jsonを取得し、afterRefからraw/<type>_<unix>.tsvを取得する。パスと40桁のcommit SHAを検証し、TSVはMD5を照合後に解析する。全てcommitを固定して取得し、後続更新と混ぜない。取得失敗・不正データを「追加なし」に変換しない。

解析結果は既存コマンドのJSONパーサーで型を検証する。diff.tsのaddedGachas / addedSales / addedItemsが追加分を抽出する。ガチャは開催枠と個別ガチャ、saleは開催枠・時間条件・各ID、itemは開催枠・gift・時間条件で比較する。Rawの改行差や、ガチャ件数が増えただけで既存ガチャを再掲しない。期間や内容が差し替わって新たに現れた項目は追加側に含む。

各コマンドのデータ取得関数は、解析済みdocumentを任意引数で受け取る。通常コマンドは従来どおりJSONを取得し、通知側はdocumentを渡して名前・ID対応表だけを取得する。ガチャのentryLabels、saleのgetStageName / isMissionId / getListStageIds、itemのgetItemScheduleNameを再利用する。

formatAddedSchedulesは追加分を開始日時順に並べ、終了済み・常設を除外し、表示行単位で重複を除いて各5件を選ぶ。予定は開始日、開催中は終了日でまとめる。missionはsaleのIDから独立分類する。名前内の改行・コードフェンスを除き、長い行を制限するため、各分類はDiscordの2000文字以内に収まる。skdHistoryUrlは旧lib/discord.jsと同じtab=history、tsv=<最新のraw時刻>、type=allを生成する。

## 配送記録

新しいphase=readyはsource { beforeRef, afterRef, files }を持つ。filesのキーは今回のtypesと一致し、pathとhashを持つ。既存detected/types/ad/noticeの入力契約は維持する。

createDetectionServiceは速報と種類の編集を先に完了し、その後詳細を作る。detailContentsに4分類とリンクの5本文をGitHubへ確定し、各チャンネルのfollowUpsへ各投稿の状態・ID・本文を記録する。同じ通知IDで再受信しても本文の再計算・送信済み投稿の再投稿をしない。

各投稿の直前に、GitHubの最新状態がpendingであることを確認し、一意なattemptIdとattemptingをSHA照合付きで保存する。同時に別処理が同じ投稿を取得しても、同じ内容のPUT成功確認を自分の送信権取得と誤認しない。結果保存では対象の投稿だけを更新する。

送信結果不明は409 reconciliation-required。後続カテゴリとリンクを保留する。未送信を確認してpendingへ戻すか、Discordで確認したmessageIdをsentへ採用してから、同じreadyを再送する。解析失敗・GitHub障害は503として同じIDで再試行する。

## 取得側との接続

KBC-rakv0-eventのlib/skd-notifications.jsがstate/skd-notifications.jsonへ通知ID、最初の検知時刻、更新前commit、対象ハッシュとrawパスを保存する。取得・保存後のreadyを再起動後も同じIDで再送する。409はheldへ記録して自動再投稿を止め、新しい更新の監視を継続する。

旧トークへのskd登録は専用data repoに保存済み。NorthflankにはGITHUB_DATA_OWNER / REPO / BRANCH / TOKENを設定し、既にNorthflankで使用中のGitHub認証を引き継いだ。初回の保存基盤デプロイで/health/liveと/healthが200になることを確認した。

## 検証

- npm test / npm run typecheck / git diff --check。
- tests/skd.test.js: 追加判定、4分類・各5件、パーサーとcommit固定・ハッシュ不一致拒否。
- tests/push.test.js: 再試行・再起動、送信結果不明時の停止、独立した受信処理間の送信権取得。
- 実データのgatya_1788844575/4576、sale_1788844575/4576、item_1788844575/4576はそれぞれ同一内容。7f9677bから16e839cまでの更新を実際のTSVと名前表で解析し、4分類とKBCリンクを生成して確認した。Discordへの試験投稿はしていない。
