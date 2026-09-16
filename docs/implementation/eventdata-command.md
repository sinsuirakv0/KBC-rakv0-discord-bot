# eventdataコマンド

## 構成

```text
src/commands/eventdata/
  command.ts       URL・添付の分岐と送信制御
  parsers.ts       種類、all、国、tsv/file、enc、kbcの解析
  domain.ts        公式・KBC URL、ファイル名、DAT暗号化
  data-source.ts   一時JWT発行、HTTP取得、サイズ制限
  types.ts         リクエストと取得口の型
src/config/eventdata.ts  origin、時間、token TTL、サイズ上限
content/help/eventdata.txt
tests/eventdata.test.js
```

`registry.ts`へ`eventDataCommand`を明示登録し、`withCommandHelp`でヘルプを読み込む。外部通信と時刻はdata source生成時に差し替えられる。

## 処理

パーサーは最初の引数を種類または`all`として確定し、残りを国とオプションとして順不同で読む。`tsv`と`file`は同じ`file: true`へ変換する。別名を正規形へまとめ、重複、不明値を拒否する。`enc`は添付指定または`kbc`がある場合だけ受け付ける。`all`でも単件と同じオプションを扱う。

公式のsale・gatya・itemには、account作成、password発行、token発行の3段階で得たJWTを付ける。引数なしの3 URLと`all`の公式URLは同じJWTを共有する。tokenは10分キャッシュし、同時発行は1個のPromiseへまとめる。ad・noticeではtokenを取得しない。URLは`[種類]`の見出しとURLを改行して組み立て、複数件は空行で区切る。添付なしの`enc kbc`では、単件・`all`ともKBC URLへ`enc=1`を付ける。

添付はContent-Lengthと読込後サイズの両方を24 MiB以下に制限し、平文TSVのタブ区切りとJSON objectを検証する。公式`enc`では取得bytesをNode cryptoで暗号化する。KBC `enc`では公式相当KBC URLへ`enc=1`を付け、KBC APIが返した暗号済みbytesをそのまま送る。元データと生成物はキャッシュしない。

`all`添付は5種類を並列取得し、全件成功後にgatya・sale・item・notice・adの順で送信する。途中の取得失敗で一部だけが送信されることを避ける。

KBC側は`D:/KBC/KBC-rakv0/api/info.js`の`source=eventdata`処理と、`vercel.json`の`/nyanko-events/...` rewriteで提供する。API内部だけでJWTを付け、公開KBC URLへは含めない。詳細は同リポジトリの`docs/api-eventdata.md`に記録する。

## 検証

`tests/eventdata.test.js`で別名・`all`・不正指定、公式・KBC URL、DAT署名、見出し付きURL表示、`tsv/file`添付を確認する。全体は`npm test`、`npm run typecheck`、`git diff --check`で確認する。
