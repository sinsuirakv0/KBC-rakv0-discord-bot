# utコマンド

## 構成

`docs/requirements/ut.md`を正本として、味方キャラ検索、JDB詳細URL、共有アセット対応のorigin画像添付、motion画像・動画生成を実装した。`registry.ts`へ`utCommand`を明示登録し、`withCommandHelp`を介して`content/help/ut.txt`を実行時に読む。

```text
src/commands/ut/
  command.ts       件数分岐、リアクション選択、ページ操作、送信制御
  data-source.ts   条件付きHTTP更新、10分キャッシュ、元アセット取得
  domain.ts        検索正規化、一致元決定、共有stemとassetパスの解決
  formatters.ts    詳細URL、候補一覧、ページ本文の整形
  parsers.ts       引数、character-index、character-assets、unitbuyの検証
  motion-renderer.ts  待機列、アセット取得、workerとFFmpegの実行・解放
  motion-worker.ts    アセット解析、区間検証、フレーム計算・画像化
  motion-canvas.ts    スプライトの切り抜き、変換、合成
  motion-progress.ts 更新間隔、通知集約、進行度メッセージ編集
  vendor/            KBC-rakv0から固定版のmotion計算を同梱
  types.ts         外部データ、検索結果、取得口の型
src/config/ut.ts   URL、TTL、HTTP・描画・リアクション設定、ページ件数
tests/ut.test.js   主要リスクの単体テスト
```

domainとdata-sourceはDiscord.js型に依存しない。時刻、fetch、URL、TTL、データ取得口、motion renderer、リアクション待機時間はテストで差し替えられる。

## 引数と検索

`origin`または`motion`より前だけを検索側、後ろだけを出力指定として解釈する。検索側の`-f`を除いた残りが検索語になる。出力指定省略時は通常検索、検索語がない場合、両方を指定した場合、未対応の指定は各操作の確定エラー文を返す。

通常検索は数字だけならID完全一致を優先する。名前検索はNFKC、大文字小文字、カタカナからひらがな、ハイフン・長音、波線類を正規化し、各形態名と別称を部分一致検索する。`-f`は正規化せず形態名だけを対象にする。

同じunit内は第一、第二、第三、第四形態、別称の順に調べ、最初の一致を表示上の一致元にする。結果は常に数値ID昇順である。

## 件数分岐とリアクション

- 1～3件: 1キャラにつき1メッセージでJDB詳細URLを送る。
- 4～9件: 数字リアクションで実行者の選択を60秒待つ。
- 10～20件: 選択なしの静的一覧を送る。
- 21件以上: 20件ずつ同じメッセージを編集する。

originは1件なら直接添付、2～9件なら同じ数字選択、10件以上なら通常一覧を使う。選択確定・時間切れでは、全リアクション削除後に本文を確定表示へ編集する。

ページ操作は1回ずつawaitするループで直列化する。有効な矢印を押すたびに、全リアクション削除、本文編集、現在ページで有効な矢印の再付与を順番にawaitする。その後に次の60秒待機を開始する。実行者以外と現在無効な絵文字はDiscordアダプターのfilterで無視する。時間切れでは全リアクションを削除して現在ページの終了案内だけを編集する。

## origin画像

`character-assets.json`のunit suffix登録を確認し、次のcodeとsuffixからパスを復元する。

- icon: `un`と`_<f|c|s|u>00.png`
- wide: `uu`と`_<f|c|s|u>.png`
- gacha: `g`と`_<f|m|z>.png`
- sprite: `i`の同じstemの`.imgcut`・`.mamodel`登録を確認し、`Number/<stem>.png`

icon、wide、spriteは、第一・第二形態について`unitbuy.csv`列61・62を調べる。`-1`なら元IDと`f`・`c`、0以上なら共有IDと`m`を使う。共有icon・wideの末尾は第一形態`m00`、第二形態`m01`である。第三・第四形態とgachaは共有解決しない。

suffixが未登録なら別形態へフォールバックしない。成功時の新規送信は、取得元basenameを維持したPNG添付だけであり、本文やURLを付けない。PNG本体はキャッシュしない。

テンプレートと全unitの全suffixは、JSONをキャッシュする前に実際の相対パスへ展開する。絶対パス、URL scheme、Windows区切り、空segment、`.`、`..`、URL制御文字を拒否する。

## motion生成

引数パーサーは出力形式、形態、モーション区間を型付きデータへ変換する。PNGは一つのモーションと0始まりの単一フレームだけを受け付ける。MP4・GIFは、`1~~15`と`1 15`を同じ両端包含範囲へ変換し、範囲なしを全フレームとして残す。

domainはoriginと同じ共有stemを一度だけ解決し、`character-assets.json`の`i`登録からPNG以外の必須ファイルと、要求された`maanim`だけを許可する。ファイル番号はmove `00`、idle `01`、attack `02`、knockback `03`である。要求された一式が欠ける場合、rendererを起動せず未登録エラーを返す。

`motion-renderer.ts`の`createUtMotionRenderer`は待機列を持つ。既定インスタンスはBotプロセス全体で共有し、元アセットの取得から生成完了まで1件ずつ処理する。`loadMotionAssets`は順番が来てから必須3ファイルと要求されたanimationだけを並列取得する。成功・失敗・範囲外のどれでも`finally`で待機列を解放する。元アセットや生成物の新しいキャッシュは設けない。

`renderInWorker`は`worker_threads`で`motion-worker.ts`を起動する。workerは同梱した`vendor/motion-engine.js`でimgcut/model/animationを解析し、全区間を検証してから描画を始める。最終フレームは`maanim`から計算し、範囲外を自動補正しない。`buildNativeDrawPackets`の結果を`motion-canvas.ts`の`@napi-rs/canvas`で描く。背景`#252a32`、640×480、30fps、原点と倍率はviewerに合わせる。取得元・関数の関係・ラスタライズ差は`src/commands/ut/vendor/docs/motion-engine.md`に記録した。

PNGは1枚だけ符号化して親へ返す。動画はPNGへ圧縮せず、RGBAフレームをworkerのstdoutからFFmpegのstdinへ順に流す。workerも書き込み完了を待つので、変換が遅くても全フレームをメモリやディスクに蓄積しない。描画とエンコードは並行して進むが、Bot本体のイベントループで描画計算をしない。文字描画はないため、workerだけ`DISABLE_SYSTEM_FONTS_LOAD=1`として不要なフォント走査を抑える。

`encoderArguments`はFFmpegの入力・フィルター・エンコーダーのスレッド数を1へ制限する。MP4はH.264の`veryfast`/CRF 23、GIFは各フレームのパレットをその場で生成する一段処理とし、動画全体を待つパレット生成を避ける。GIFは30fpsをGIFの時間精度に丸め、無限ループを付ける。MP4は速さ優先で圧縮効率が多少下がり、GIFはフレームごとのパレット・Bayerディザとなる。

一時保存は最終動画ファイル一つだけとする。親が60秒のworker全体タイムアウトを持ち、成功・失敗・時間切れ時にworker、FFmpeg、一時ファイルを解放する。待機列とHTTP取得はこの60秒に含めず、HTTPは各リクエストの10秒タイムアウトを本文読み取りまで適用する。停止したworkerのFFmpegが孤児化しないよう、FFmpegは親側で起動・停止する。

command層は通常検索と同じ候補数分岐を使い、1件またはリアクションで確定した1件だけをrendererへ渡す。データ取得失敗、未登録、範囲外、生成失敗を別の利用者向け文言へ変換し、内部情報はログだけに残す。

`sendMotion`はキャラ確定後に本文を一つ送り、`motion-progress.ts`へ渡す。rendererからの通知は待機・取得・フレーム生成・動画仕上げへ変換し、添付送信の前後は送信中・完了へ編集する。生成中だけ実フレーム数から割合を算出する。同段階の更新は2秒以上空け、Discord編集中は最新本文一つへ集約する。編集失敗は生成を失敗させず、終了後に遅れた進行度で完了文を上書きしない。

## コンテナ

Playwright/Chromiumへの依存を外し、`Dockerfile`は`node:22-bookworm-slim`を使う。builderで`npm ci`、ビルド、開発依存の除外を行い、実行ステージには本番`node_modules`と`dist`・`content`をコピーする。FFmpegを両ステージでダウンロードし直さない。`@napi-rs/canvas`は[公式の対応環境](https://github.com/Brooooooklyn/canvas#support-matrix)に沿ってglibc版を使用する。Northflankでは変更後のDockerイメージの再ビルドが必要になる。

## JSON検証とキャッシュ

`schemaVersion`値は判定に使わない。character-indexは連続ID配列、1～4形態の名前・説明、別称配列を全unitで検証する。character-assetsは連続ID配列、pathTemplates、各codeのsuffix配列、復元される全パスを全unitで検証する。unitbuyは空行を除く全行の列数と列61・62の整数を検証する。1件でも不正なら新データ全体を採用しない。

index、assets、unitbuyは別々の10分キャッシュを持ち、assetsとunitbuyは最初に必要となるoriginまたはmotion実行まで取得しない。期限内は通信しない。期限後は保存済みETagとLast-Modifiedを条件付きGETへ付け、304なら本文を読まず期限だけ更新する。200では本文SHA-256も比較するため、gameVersionが同じでもaliasesなどの内容変更を検知できる。validatorが提供されない場合も本文hashで判定する。

HTTP、JSON・CSV解析、全件検証に失敗した場合、新データはキャッシュへ入れず直前の正常値を返す。正常値がない場合だけコマンド層が確定済み取得失敗文へ変換する。PNG、imgcut、mamodel、maanimは都度取得し、キャッシュしない。内部URL、HTTPステータス、例外詳細はログだけへ出す。

## 検証範囲

単体テストは検索一致元と正規化、3/4/9/10/20/21件境界、選択確定と時間切れ、ページ操作順、originパスと添付名、motion引数、共有stemとrender plan、全件検証、条件付き更新、内容変更、stale fallback、遅延取得、元アセット非キャッシュを確認する。軽量rendererは小さい合成fixtureでPNGの寸法・色、MP4/GIFの実デコード後の枚数・区間順序、4合成モード、失敗後の待機列解放を確認する。進行度は差し替え時刻で間隔・通知集約・終了後の上書き防止を確認する。

ローカルの`D:/KBC/KBC-rakv0-assets/jp/sitedata`でも読み取り専用スモークを行い、2026年9月12日時点のindex・assets各876件とunitbuy 876行を検証した。通常形態のPNG・MP4・GIF生成と、ID 656第一形態が共有`000_m`一式からPNG生成できることを、公開viewerと実データで確認した。

同日のWindows上で、ローカル元アセット・ID 000第一形態・攻撃0～9を3回連結した30フレームMP4を比較した。旧方式は約9.5秒、新方式は約1.3秒だった（単発計測、旧方式には公開viewer読み込みを含む）。Northflankの実測値ではなく、無料コンテナでの速度やメモリ上限への適合を保証する数値ではない。この環境にはDockerがなく、Linuxイメージのビルド検証とDiscord実送信は未実施。
