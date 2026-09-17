# tutコマンド

## 構成

`docs/requirements/tut.md`を正本として、敵ユニットの名前・別称・ID検索、JDB詳細URL、関連元ファイル選択、互換用origin画像添付、motion画像・動画生成を実装した。`registry.ts`には`tutCommand`だけを`withCommandHelp`で明示登録し、`enemy`別名は登録しない。

```text
src/commands/tut/
  command.ts       件数分岐、リアクション選択、ページ操作、送信制御
  data-source.ts   TSV・JSONの条件付き更新、一括キャッシュ、PNG・敵モーション元アセット取得
  domain.ts        検索データ構築、名前・ID検索、ダミー表示名、敵render plan
  formatters.ts    JDB URL、候補一覧、ページ本文の整形
  parsers.ts       引数、Enemyname.tsv、enemyname.jsonの検証
  types.ts         検索データ、検索結果、取得口の型
src/commands/shared/motion/  ut・tut共通の引数解析、待機列、worker、Canvas、進行度
src/commands/shared/file-picker.ts  ut・tut共通の9件ページ選択
src/config/tut.ts  URL、TTL、HTTP・リアクション時間、ページ件数
src/config/motion.ts  共通の画角・サイズ・生成制限
tests/tut.test.js  検索・表示・件数境界・キャッシュ・motionの主要テスト
```

時刻、fetch、データ取得口、HTTP・リアクション時間、ページ件数は差し替え可能である。Discordに依存しない解析・検索・取得処理はコマンド層から分離した。

## データ構築と検索

`Enemyname.tsv`の0始まり行番号を数値ID、空欄以外の行を正本の表示名にする。`enemyname.json`は全要素の非負整数IDと空でない`names[]`を検証し、存在するTSV IDだけへ別称を追加する。表示名と同じ文字列および重複別称は、元の順序を維持して除く。JSONの`url`は参照しない。

半角数字だけの入力は先頭ゼロを数値化し、存在するIDへ完全一致させる。不在の場合だけ名前検索する。通常検索は`src/commands/shared/search.ts`のNFKC・英字大小・かな・ハイフン・波形正規化を使う。`-f`と`-force`は引数内の位置を問わず除去し、raw表示名とraw別称を検索する。複数語ANDは各表示名または各別称の内部だけで判定し、名前間をまたがない。

TSV表示名が`ダミー`の場合、別称一致では最初に一致した別称、それ以外では最初の非ダミー別称を`{別称} (ダミー)`として表示する。非ダミー別称がなければ`ダミー`のままとする。この表示名は詳細、候補、選択済み、ページで共通に使う。

## 表示と操作

- 1～3件は1件ずつ、非ゼロ埋めIDとJDB URLを送る。
- 4～9件は実行者の数字リアクションを60秒待ち、選択または時間切れでリアクションを消して本文を確定する。
- 10～20件は選択なしの一覧を送る。
- 21件以上は20件ずつ同じメッセージを編集する。有効な矢印操作ごとに60秒の待機を再開する。

ページ操作は待機、リアクション削除、本文編集、有効な矢印の再付与を1回ずつawaitして直列化する。見出しには解析後の元検索語を使うため、`-f`、`-force`、`file`、`origin`、`motion`以下の出力指定を含めない。

## fileとorigin互換

`resolveEnemyFileOptions`は敵IDから、敵アイコン・スプライト・`imgcut`・`mamodel`・`00`～`03.maanim`の固定候補を生成する。`createRemoteUtDataSource`の安全な相対アセット取得とHEAD存在確認を再利用し、実在する候補だけを共通`selectAssetFile`へ渡す。一覧は1ページ9件で、数字と`◀️`・`▶️`を同じメッセージ上で付け直す。選択したファイル本体だけをGETして添付する。

旧`origin`は1件一致なら直接、2～9件なら数字選択後に`enemy_icon_{3桁ID}.png`を取得してPNGだけを添付する。10件以上は通常一覧でID再検索を案内する。画像は毎回HTTP取得し、状態を確認して10秒で打ち切る。失敗時はフォールバックせず固定の画像エラーを返す。

## motion生成

`parseTutRequest`は`file`、従来の`origin`と検索フラグに加え、`motion`以降だけを`shared/motion/parser.ts`へ渡す。共通パーサーに形態候補を渡さないため、敵の引数では`f`・`c`・`s`・`u`を受け付けない。PNGの単一0始まりフレーム、MP4・GIFの両端包含範囲、`--full`の解釈は`ut`と同じである。`-f`・`-force`は既存`tut`仕様どおり位置を問わず取り除く。

`createRemoteTutDataSource`は敵名前と別称の一括キャッシュを維持しつつ、`createRemoteUtDataSource`の安全な相対アセット取得とHEAD確認を再利用する。敵の元ファイルは`Number/{3桁ID}_e.png`と`ImageData/{3桁ID}_e.imgcut`・`_e.mamodel`・`_e00`～`_e03.maanim`である。検索メタデータとHEAD結果は10分キャッシュし、元ファイルは非キャッシュ・HTTP10秒・ステータス確認となる。

`resolveEnemyMotionPlan`は敵IDと要求されたアニメーションから、`filenameStem`・`previewScale`と固定規則の元パスを共通`MotionPlan`へ組み立てる。`shared/motion/asset-suffix.ts`が`ut`と共通のファイル番号を決め、move 00、idle 01、attack 02、knockback 03とする。ID 0は既存敵viewerと同じ補正倍率2.25を設定する。必要一式をHEAD確認し、不存在ならrendererを呼ばず、別ID・味方形態へフォールバックしない。

`sendEnemyMotion`は検索結果が1件なら直接、2～9件なら数字リアクションで1件を確定し、10件以上なら一覧を表示する。確定後は進行度本文一つを編集し、共通rendererへ要求を渡す。既定rendererの待機列は`ut`・`tut`で同一なので、元ファイル取得から生成終了まで同時に1件となる。共通workerが画角を動画全体で固定し、通常の縦強・横緩の制限と`--full`、PNG4倍の上限、動画のストリーミング、無進捗60秒・全体10分を適用する。メタデータ取得失敗、未登録、範囲外、生成失敗、時間制限はそれぞれ固定文へ変換し、内部詳細だけをログへ残す。

## 一括キャッシュ

TSVとJSONを1個の検索データとして10分保持する。期限内は通信せず、期限後は各URLのETagとLast-Modifiedで条件付きGETする。304または本文SHA-256が同一なら既存データを維持し、検証時刻とvalidatorだけ更新する。

変更時は両本文の取得、全解析・検証、検索データ構築がすべて成功してから、本文状態と検索データをまとめて切り替える。並行更新は1個のPromiseを共有する。更新失敗時は直前の正常値を返し、初回失敗だけコマンド層で固定の取得失敗文へ変換する。内部詳細はログだけに残す。

## 検証方法

```text
npm test
npm run typecheck
git diff --check
```

`tests/tut.test.js`では引数、ID・正規化・raw・複数語検索、ダミー表示名、件数境界、file選択、origin互換添付、一括キャッシュ、条件付き更新、stale fallback、元ファイル非キャッシュ、敵motion引数・HEAD判定・選択と送信・範囲外を確認する。共通workerのPNG・MP4・GIF、画角、待機列、時間監視は`tests/ut.test.js`の小さなfixtureで確認する。
