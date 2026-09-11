# skd詳細通知の実装

## データと表示

src/notifications/skd/parsersの3ファイルはKBC-rakv0-eventのparsersから同梱したもの。元パーサー最終変更はe839f3cf8bc9f4a7f48f0b6e90390b5b57823313。実行時に外部JavaScriptを評価せず、allowJsでビルド時に取り込む。更新時は取得側パーサーとの整合を確認する。

createScheduleDetailsBuilderはreadyイベントのbeforeRefのGit treeを取得し、種類ごとにraw/<type>_<unix>.tsvの時刻が最大のファイルを比較元にする。afterRefから今回のrawを取得し、前後とも同梱パーサーで解析する。更新前JSONは比較に使わない。パスと40桁のcommit SHAを検証し、今回のTSVはMD5も照合する。全てcommitを固定して取得し、後続更新と混ぜない。更新前rawの欠落、treeの打ち切り、取得失敗・不正データを「追加なし」に変換しない。

解析結果は既存コマンドのJSONパーサーで型を検証する。diff.tsのcompareGachas / compareSales / compareItemsは、まず完全一致する項目を除き、残った前後の項目を日時・バージョン以外の一致で対応付ける。ガチャは種類と個別ガチャの全内容、saleは各IDと時間条件、itemはgiftと時間条件を照合する。対応する候補が複数ある場合は変更されたheader項目数が少ないものを優先する。対応した項目はchanges、それ以外の新しい項目はaddedへ分ける。元の予定が残ったまま同じIDの別期間が増えた場合は追加となる。Rawの改行差やガチャ件数だけの差は無視し、saleの追加項目は元の開催枠へ戻して一覧の代表ID選択を保つ。

各コマンドのデータ取得関数は、解析済みdocumentを任意引数で受け取る。通常コマンドは従来どおりJSONを取得し、通知側はdocumentを渡して名前・ID対応表だけを取得する。ガチャのentryLabels、saleのgetStageName / isMissionId / getListStageIds、itemのgetItemScheduleNameを再利用する。

formatAddedSchedulesは追加分を開始日時順に並べ、終了済み・常設を除外し、項目単位で重複を除いて各5件を選ぶ。予定は開始日、開催中は終了日でまとめる。missionはsaleのIDから独立分類し、getStageNameのpreserveLineBreaksオプションで原文の<br>を改行へ変換する。続きの行も字下げし、複数行のmissionを1件として数える。通常のsaleコマンドは従来の表示を保つ。コードフェンスを除去し、字下げを含む各項目を244文字までに制限してDiscordの2000文字以内に収める。skdHistoryUrlは旧lib/discord.jsと同じtab=history、tsv=<最新のraw時刻>、type=allを生成する。

追加がない種類は省き、formatChangesが4種類の日時・必要バージョン・上限バージョンの変更を1つのコードブロックへまとめる。表示順はgatya、sale、item、mission、上限は全体で5件。項目ごとに変更前→変更後を示す。変更項目は名前120文字・全体360文字までとし、2000文字以内に収める。変更がない場合は欄ごと省き、最後にKBCリンクを付ける。

## 配送記録

新しいphase=readyはsource { beforeRef, afterRef, files }を持つ。filesのキーは今回のtypesと一致し、pathとhashを持つ。既存detected/types/ad/noticeの入力契約は維持する。

createDetectionServiceは速報と種類の編集を先に完了し、その後詳細を作る。detailContentsに追加分・変更欄・リンクの1〜6本文をGitHubへ確定し、各チャンネルのfollowUpsへ各投稿の状態・ID・本文を記録する。followUpsの件数は確定本文の件数と一致させる。旧形式の5本文も読み込める。同じ通知IDで再受信しても本文の再計算・送信済み投稿の再投稿をしない。

各投稿の直前に、GitHubの最新状態がpendingであることを確認し、一意なattemptIdとattemptingをSHA照合付きで保存する。同時に別処理が同じ投稿を取得しても、同じ内容のPUT成功確認を自分の送信権取得と誤認しない。結果保存では対象の投稿だけを更新する。

送信結果不明は409 reconciliation-required。後続カテゴリとリンクを保留する。未送信を確認してpendingへ戻すか、Discordで確認したmessageIdをsentへ採用してから、同じreadyを再送する。解析失敗・GitHub障害は503として同じIDで再試行する。

## 取得側との接続

KBC-rakv0-eventのlib/skd-notifications.jsがstate/skd-notifications.jsonへ通知ID、最初の検知時刻、更新前commit、対象ハッシュとrawパスを保存する。取得・保存後のreadyを再起動後も同じIDで再送する。409はheldへ記録して自動再投稿を止め、新しい更新の監視を継続する。

旧トークへのskd登録は専用data repoに保存済み。NorthflankにはGITHUB_DATA_OWNER / REPO / BRANCH / TOKENを設定し、既にNorthflankで使用中のGitHub認証を引き継いだ。初回の保存基盤デプロイで/health/liveと/healthが200になることを確認した。

## 検証

- npm test / npm run typecheck / git diff --check。
- tests/skd.test.js: 追加・変更の判別、4分類・追加各5件・変更合計5件、空の種類の省略、missionの改行、前回rawの選択と同一パーサーでの比較、commit固定・ハッシュ不一致・履歴欠落の拒否。
- tests/push.test.js: 再試行・再起動、送信結果不明時の停止、独立した受信処理間の送信権取得。
- 実データのgatya_1788844575/4576、sale_1788844575/4576、item_1788844575/4576はそれぞれ同一内容。7f9677bから16e839cまでの更新を実際のTSVと名前表で解析し、4分類とKBCリンクを生成して確認した。Discordへの試験投稿はしていない。
