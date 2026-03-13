import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Message,
  TextChannel,
} from "discord.js";
import { Command } from "../types/Command";

const STATUS: { offset: number; name: string }[] = [
  { offset: -24, name: "体力" },
  { offset: -20, name: "KB" },
  { offset: -16, name: "速度" },
  { offset: -12, name: "攻撃力" },
  { offset:  -8, name: "攻撃終了～移動(pf)" },
  { offset:  -4, name: "射程" },
  { offset:   0, name: "お金" },
  { offset:   4, name: "再生産(pf)" },
  { offset:   8, name: "当たり判定の位置" },
  { offset:  12, name: "当たり判定の幅" },
  { offset:  16, name: "赤い敵" },
  { offset:  20, name: "？？？" },
  { offset:  24, name: "攻撃種類(0=単体/1=範囲)" },
  { offset:  28, name: "攻撃感知～攻撃発生(f)" },
  { offset:  32, name: "最小レイヤー ※手前50 奥0" },
  { offset:  36, name: "最大レイヤー" },
  { offset:  40, name: "浮いている敵" },
  { offset:  44, name: "黒い敵" },
  { offset:  48, name: "メタルな敵" },
  { offset:  52, name: "無属性" },
  { offset:  56, name: "天使" },
  { offset:  60, name: "エイリアン" },
  { offset:  64, name: "ゾンビ" },
  { offset:  68, name: "【めっぽう強い】" },
  { offset:  72, name: "【ふっとばす】" },
  { offset:  76, name: "【動きを止める】発動確率(%)" },
  { offset:  80, name: "【動きを止める】効果時間(f)" },
  { offset:  84, name: "【動きを遅くする】発動確率(%)" },
  { offset:  88, name: "【動きを遅くする】効果時間(f)" },
  { offset:  92, name: "【打たれ強い】" },
  { offset:  96, name: "【超ダメージ】" },
  { offset: 100, name: "【クリティカル】発動確率(%)" },
  { offset: 104, name: "【ターゲット限定】" },
  { offset: 108, name: "【撃破時お金アップ】" },
  { offset: 112, name: "【城破壊が得意】" },
  { offset: 116, name: "【波動攻撃】発動確率(%)" },
  { offset: 120, name: "波動Lv" },
  { offset: 124, name: "【攻撃力ダウン】発動確率(%)" },
  { offset: 128, name: "【攻撃力ダウン】発動時間(f)" },
  { offset: 132, name: "【攻撃力ダウン】ダウン割合(%) ※(x/100)×攻撃力" },
  { offset: 136, name: "【攻撃力アップ】体力割合(%)" },
  { offset: 140, name: "【攻撃力アップ】増加割合(%) ※(1+x/100)×攻撃力" },
  { offset: 144, name: "【生き残る】発動確率(%)" },
  { offset: 148, name: "【メタル】" },
  { offset: 152, name: "【遠方攻撃】最短射程" },
  { offset: 156, name: "【遠方攻撃】最短射程～最長射程の距離" },
  { offset: 160, name: "【波動ダメージ無効】" },
  { offset: 164, name: "【波動ダメージ耐性】" },
  { offset: 168, name: "【ふっとばす無効】" },
  { offset: 172, name: "【動きを止める無効】" },
  { offset: 176, name: "【動きを遅くする無効】" },
  { offset: 180, name: "【攻撃力ダウン無効】" },
  { offset: 184, name: "【ゾンビキラー】" },
  { offset: 188, name: "【魔女キラー】" },
  { offset: 192, name: "魔女" },
  { offset: 196, name: "Attacks before" },
  { offset: 200, name: "【衝撃波無効】" },
  { offset: 204, name: "Time before dying" },
  { offset: 208, name: "Unit state" },
  { offset: 212, name: "攻撃力 二撃目" },
  { offset: 216, name: "攻撃力 三撃目" },
  { offset: 220, name: "攻撃感知～攻撃発生 二撃目(f)" },
  { offset: 224, name: "攻撃感知～攻撃発生 三撃目(f)" },
  { offset: 228, name: "効果,能力 一撃目" },
  { offset: 232, name: "効果,能力 二撃目" },
  { offset: 236, name: "効果,能力 三撃目" },
  { offset: 240, name: "生産アニメーション ※-1:unit 0:モンハン" },
  { offset: 244, name: "昇天エフェクト" },
  { offset: 248, name: "生産アニメーション" },
  { offset: 252, name: "昇天エフェクト ※1:無効 2:有効" },
  { offset: 256, name: "【バリアブレイカー】発動確率(%)" },
  { offset: 260, name: "【ワープ】発動確率(%)" },
  { offset: 264, name: "【ワープ】発動時間(f)" },
  { offset: 268, name: "【ワープ】最短射程" },
  { offset: 272, name: "【ワープ】最短射程～最長射程の距離" },
  { offset: 276, name: "【ワープ無効】" },
  { offset: 280, name: "使徒" },
  { offset: 284, name: "【使徒キラー】" },
  { offset: 288, name: "古代種" },
  { offset: 292, name: "【古代の呪い無効】" },
  { offset: 296, name: "【超打たれ強い】" },
  { offset: 300, name: "【極ダメージ】" },
  { offset: 304, name: "【渾身の一撃】発動確率(%)" },
  { offset: 308, name: "【渾身の一撃】増加割合(%) ※1+(x/100)" },
  { offset: 312, name: "【攻撃無効】発動確率(%)" },
  { offset: 316, name: "【攻撃無効】発動時間(f)" },
  { offset: 320, name: "【烈波攻撃】発動確率(%)" },
  { offset: 324, name: "【烈波攻撃】最短射程 ※÷4する" },
  { offset: 328, name: "【烈波攻撃】最短射程～最長射程の距離 ※÷4する" },
  { offset: 332, name: "烈波Lv" },
  { offset: 336, name: "【毒撃ダメージ無効】" },
  { offset: 340, name: "【烈波ダメージ無効】" },
  { offset: 344, name: "【呪い】" },
  { offset: 348, name: "【呪い】発動時間(f)" },
  { offset: 352, name: "【小波動】(波動有効時のみ有効)" },
  { offset: 356, name: "【シールドブレイカー】発動確率(%)" },
  { offset: 360, name: "悪魔" },
  { offset: 364, name: "【超生命体特攻】" },
  { offset: 368, name: "【魂攻撃】" },
  { offset: 372, name: "【遠方攻撃】二撃目" },
  { offset: 376, name: "【遠方攻撃】二撃目 最短射程" },
  { offset: 380, name: "【遠方攻撃】二撃目 最短射程～最長射程の距離" },
  { offset: 384, name: "【遠方攻撃】三撃目" },
  { offset: 388, name: "【遠方攻撃】三撃目 最短射程" },
  { offset: 392, name: "【遠方攻撃】三撃目 最短射程～最長射程の距離" },
  { offset: 396, name: "【超獣特攻】" },
  { offset: 400, name: "【超獣特攻】発動確率(%)" },
  { offset: 404, name: "【超獣特攻】攻撃無効(f)" },
  { offset: 408, name: "【小烈波】烈波有効時のみ有効" },
  { offset: 412, name: "【列波カウンター】" },
  { offset: 416, name: "召喚するunit番号" },
  { offset: 420, name: "【超賢者特攻】" },
  { offset: 424, name: "メタルキラー" },
  { offset: 428, name: "【爆波】発動確率(%)" },
  { offset: 432, name: "【爆波】範囲の前方 ※×4する" },
  { offset: 436, name: "【爆波】範囲の後方 ※×4する" },
  { offset: 440, name: "【爆波無効】" },
];

const PAGE_SIZE = 20;
const TOTAL_PAGES = Math.ceil(STATUS.length / PAGE_SIZE);

// インデックス → Excel列名（A, B, ... Z, AA, AB ...）
function indexToCol(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function buildEmbed(page: number): EmbedBuilder {
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, STATUS.length);
  const lines = STATUS.slice(start, end).map((s, i) => {
    const col = indexToCol(start + i);
    return `\`${col.padEnd(3)}\` ${s.name}`;
  });

  return new EmbedBuilder()
    .setTitle("一覧")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `ページ ${page + 1} / ${TOTAL_PAGES}　全${STATUS.length}件` });
}

function buildRow(page: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("prev")
      .setLabel("◀ 前へ")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId("next")
      .setLabel("次へ ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === TOTAL_PAGES - 1),
  );
}

const unitCSV: Command = {
  name: "unitCSV",
  description: "unitCSVの意味をまとめてます",
  usage: "o.unitCSV",

  async execute(message: Message): Promise<void> {
    const channel = message.channel as TextChannel;
    let page = 0;

    const sent = await channel.send({
      embeds: [buildEmbed(page)],
      components: [buildRow(page)],
    });

    const collector = sent.createMessageComponentCollector({
      filter: (i) => i.user.id === message.author.id,
      time: 5 * 60 * 1000, // 5分
    });

    collector.on("collect", async (interaction) => {
      if (interaction.customId === "prev" && page > 0) page--;
      else if (interaction.customId === "next" && page < TOTAL_PAGES - 1) page++;

      await interaction.update({
        embeds: [buildEmbed(page)],
        components: [buildRow(page)],
      });
    });

    collector.on("end", async () => {
      // タイムアウト後ボタンを無効化
      await sent
        .edit({
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId("prev")
                .setLabel("◀ 前へ")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
              new ButtonBuilder()
                .setCustomId("next")
                .setLabel("次へ ▶")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            ),
          ],
        })
        .catch(() => void 0);
    });
  },
};

module.exports = unitCSV;
