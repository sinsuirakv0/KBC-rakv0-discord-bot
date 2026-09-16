# o.eventdata 仕様

このコマンドは、公式イベントサーバーのsale・gatya・item・広告制御・popup noticeについて、URL表示または元ファイル・暗号化DATの添付を行う。

## 構文

```text
o.eventdata
o.eventdata all [国] [tsv|file] [enc] [kbc]
o.eventdata <種類> [国] [tsv|file] [enc] [kbc]
```

- 種類は`sale`、`gatya`、`item`、`ad`、`notice`。
- `all`は全種類のURL表示または添付を行う特別指定。国、`tsv|file`、`enc`、`kbc`を併用できる。
- `popup_notice`と`placement`は`notice`の別名。
- 国は`jp`、`en`、`kr`、`tw`。`ja`は`jp`、`ko`は`kr`の別名。省略時は`jp`。
- `tsv`と`file`は同じ添付指定。種類・国より後ろで指定し、sale・gatya・itemはTSV、ad・noticeはJSONとして送る。
- `enc`は`tsv`、`file`または`kbc`との併用時だけ使用できる。添付時は内容をゲーム互換DATへ暗号化し、添付なしの`kbc`では暗号化データを返すURLを表示する。
- `kbc`は取得元または表示URLを、公式URLからKBC URLへ切り替える。
- 国・各オプションの重複、不明な引数、`tsv`・`file`・`kbc`なしの`enc`は不正指定とする。
- サーバー内では全ユーザーが利用でき、DMでは反応しない。

## URL表示

引数なしではJP版のgatya・sale・itemについて、1個の一時JWTを共有したJWT付き公式URLを3件表示する。ad・noticeは含めない。

添付指定なしの`all`ではgatya・sale・item・notice・adの順に全5件を表示する。国を省略した場合はJPとし、`kbc`を併用できる。`enc`は`kbc`との併用時だけ指定でき、全URLへ`enc=1`を付ける。

種類指定・添付指定なしでは、その種類と国のURLを1件表示する。公式sale・gatya・itemでは一時JWTを発行してqueryへ付ける。ad・noticeにはJWTを付けない。

`kbc`指定では、`https://kbc-rakv0.vercel.app/nyanko-events/`以下の公式に近いpathを返す。sale・gatya・itemの拡張子は`.tsv`で、JWT queryは不要とする。

添付指定なしで`enc`と`kbc`を併用した場合は、KBC URLへ`enc=1`を付ける。`kbc`なしの`enc`は、従来どおり`tsv`または`file`が必要となる。

URLは単件・複数件とも、種類を角括弧の見出しにして表示する。複数件の間には空行を入れる。

```text
[gatya]
URL

[sale]
URL
```

例:

```text
https://kbc-rakv0.vercel.app/nyanko-events/battlecats_production/sale.tsv
https://kbc-rakv0.vercel.app/nyanko-events/control/placement/battlecats/event.json
```

## 公式取得先

- sale: `https://nyanko-events.ponosgames.com/<product>_production/sale.tsv?jwt=...`
- gatya: `https://nyanko-events.ponosgames.com/<product>_production/gatya.tsv?jwt=...`
- item: `https://nyanko-events.ponosgames.com/<product>_production/item.tsv?jwt=...`
- ad: `https://nyanko-events.ponosgames.com/control/ad/battlecats/adcontrol.json`
- notice: `https://nyanko-events.ponosgames.com/control/placement/<product>/event.json`

地域productはJP `battlecats`、EN `battlecatsen`、KR `battlecatskr`、TW `battlecatstw`。JPのevent pathだけ`battlecats_production`とし、それ以外はproductへ`_production`を付ける。海外のad pathは公式から403になるため、adだけ国指定に関係なくJPの`battlecats`を使用する。

## 添付と暗号化

平文の添付名は`sale.tsv`、`gatya.tsv`、`item.tsv`、`ad.json`、`popup_notice.json`。

`all`へ`tsv`または`file`を付けた場合は、gatya・sale・item・notice・adの順で5ファイルを添付する。`enc`と`kbc`の扱いは単件添付と同じとし、全件の取得に成功してから送信を開始する。

暗号化はAES-128-ECB・PKCS#7を使い、鍵は`MD5("battlecats")`の先頭16文字をUTF-8として扱う。暗号文末尾へ、地域別saltと暗号文から計算したMD5を小文字ASCII 32文字で追加する。地域別saltは`battlecats`、`battlecatsen`、`battlecatskr`、`battlecatstw`。

暗号添付名は次の固定値とする。

- sale: `002a4b18244f32d7833fd81bc833b97f.dat`
- gatya: `09b1058188348630d98a08e0f731f6bd.dat`
- item: `408f66def075926baea9466e70504a3b.dat`
- ad: `523af537946b79c4f8369ed39ba78605.dat`
- notice: `e4698396f16e151d6634fee4dfa32741.dat`

`kbc`と`enc`を併用する場合は、KBC URLへ`enc=1`を付け、KBC側で暗号化された内容を取得してそのまま添付する。公式モードではBot側で暗号化する。

## 通信とエラー

- 公式JWTは既存event appと同じ一時アカウント・token発行手順を使い、10分間だけプロセス内で再利用する。
- 認証情報とJWTはログへ記録しない。URL表示を明示的に要求した場合だけJWT付き公式URLをDiscordへ返す。
- HTTPは10秒で打ち切り、ステータスを確認する。平文は空でないことに加え、TSVのタブ区切りまたはJSON objectを検証する。添付は24 MiBを上限とし、キャッシュしない。
- 不正指定は`❌ 指定が正しくありません。o.eventdata help で使い方を確認してください。`。
- 認証、取得、暗号化、送信の失敗は`❌ eventdataの取得に失敗しました。時間をおいて再度お試しください。`。内部詳細はログだけに残す。
