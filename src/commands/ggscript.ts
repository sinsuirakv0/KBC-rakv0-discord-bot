import { AttachmentBuilder, Message, TextChannel } from "discord.js";
import { Command } from "../types/Command";

// ============================================================
// STATUSリスト（script-generator.html と同一）
// ============================================================
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

// ============================================================
// Excel列名 → 0ベースインデックス変換
// ============================================================
function colToIndex(col: string): number {
  let n = 0;
  for (const c of col.toUpperCase()) {
    n = n * 26 + (c.charCodeAt(0) - 64);
  }
  return n - 1;
}

// ============================================================
// プリセット文字列をパース（例: "A1,AE24" → [{offset, val, name}]）
// ============================================================
interface PresetEntry { offset: number; val: number; name: string }

function parsePreset(presetStr: string): PresetEntry[] {
  const entries: PresetEntry[] = [];
  for (const token of presetStr.split(",")) {
    const m = token.trim().match(/^([A-Za-z]+)(-?\d+)$/);
    if (!m) continue;
    const idx = colToIndex(m[1]);
    const val = parseInt(m[2]);
    if (idx < 0 || idx >= STATUS.length) continue;
    entries.push({ offset: STATUS[idx].offset, val, name: STATUS[idx].name });
  }
  return entries;
}

// ============================================================
// Lua生成（buildLua in HTML と同等）
// ============================================================
function buildLua(
  pattern: string,
  refine: number,
  range: string,
  presets: PresetEntry[],
): string {
  const statusLines = STATUS.map(
    (s) => `  {offset=${String(s.offset).padStart(5)}, name="${s.name}"}`
  ).join(",\n");

  let autoApplyBlock = "";
  if (presets.length > 0) {
    const lines = presets
      .map((p) => `  applyEdit(${p.offset}, ${p.val})  -- ${p.name}`)
      .join("\n");
    autoApplyBlock = `
-- ============================================================
-- 起動時プリセット自動適用 (${presets.length}件)
-- ============================================================
${lines}
gg.toast("プリセット適用完了 (${presets.length}件)")
`;
  }

  return `-- ============================================================
-- nyanko status editor
-- 製作者:健康おじと愉快なAI達
-- ============================================================

local SEARCH_PATTERN = "${pattern}"
local REFINE_VALUE   = ${refine}
local SEARCH_RANGE   = ${range}

-- ============================================================
-- STATUS
-- ============================================================
local STATUS = {
${statusLines}
}

-- ============================================================
-- 検索・リファイン
-- ============================================================
gg.clearResults()
gg.setRanges(SEARCH_RANGE)
gg.searchNumber(SEARCH_PATTERN, gg.TYPE_DWORD)

local results = gg.getResults(99999)
gg.clearResults()

if not results or #results == 0 then
  gg.alert("自動検索で見つかりませんでした\\n手動で入力してください")
  local inp = gg.prompt(
    {"検索パターン", "リファイン値（コスト値）"},
    {SEARCH_PATTERN, tostring(REFINE_VALUE)},
    {"text", "number"}
  )
  if not inp then
    gg.toast("キャンセルされました")
    return
  end
  SEARCH_PATTERN = inp[1]
  REFINE_VALUE   = math.floor(tonumber(inp[2]) or 0)

  gg.clearResults()
  gg.setRanges(SEARCH_RANGE)
  gg.searchNumber(SEARCH_PATTERN, gg.TYPE_DWORD)
  results = gg.getResults(99999)
  gg.clearResults()

  if not results or #results == 0 then
    gg.alert("見つかりませんでした\\nスクリプトを終了します")
    return
  end
end

gg.toast("検索: " .. #results .. "件ヒット", true)

local refined = {}
for _, r in ipairs(results) do
  if r.value == REFINE_VALUE then
    table.insert(refined, {address = r.address})
  end
end

if #refined == 0 then
  gg.alert("リファイン失敗\\nコスト値 [" .. REFINE_VALUE .. "] に一致するものがありませんでした\\n(検索結果: " .. #results .. "件)")
  return
end

gg.toast("対象: " .. #refined .. "件", true)

local baseAddr    = refined[1].address
local baseAddrHex = string.format("0x%X", baseAddr)

-- ============================================================
-- バックアップ
-- ============================================================
local backup = {}
for _, ref in ipairs(refined) do
  local readList = {}
  for _, s in ipairs(STATUS) do
    table.insert(readList, {address = ref.address + s.offset, flags = gg.TYPE_DWORD})
  end
  table.insert(backup, {baseAddr = ref.address, vals = gg.getValues(readList)})
end

-- ============================================================
-- 書き換え
-- ============================================================
local function applyEdit(offset, val)
  local editList = {}
  for _, ref in ipairs(refined) do
    table.insert(editList, {
      address = ref.address + offset,
      flags   = gg.TYPE_DWORD,
      value   = math.floor(tonumber(val) or 0)
    })
  end
  gg.setValues(editList)
end

-- ============================================================
-- リストに保存
-- ============================================================
local function saveToList()
  local readList = {}
  for _, s in ipairs(STATUS) do
    table.insert(readList, {address = baseAddr + s.offset, flags = gg.TYPE_DWORD})
  end
  local cur = gg.getValues(readList)
  local listItems = {}
  for i, s in ipairs(STATUS) do
    table.insert(listItems, {
      address = baseAddr + s.offset,
      flags   = gg.TYPE_DWORD,
      value   = cur[i] and cur[i].value or 0,
      name    = s.name
    })
  end
  gg.addListItems(listItems)
  gg.toast("リストに追加しました (" .. #listItems .. "件)")
end
${autoApplyBlock}
-- ============================================================
-- メニュー定義
-- ============================================================
local MAIN_MENU = {
  "ステータスを変更する",
  "元の値に戻す",
  "リストに保存",
  "スクリプトを終了"
}
local CONFIRM_MENU = {"はい", "いいえ"}

local lastMainPos   = nil
local lastStatusPos = nil
local currentScreen = "main"

-- ============================================================
-- メインループ
-- ============================================================
while true do

  if currentScreen == "status" then

    local readList = {}
    for _, s in ipairs(STATUS) do
      table.insert(readList, {address = refined[1].address + s.offset, flags = gg.TYPE_DWORD})
    end
    local cur = gg.getValues(readList)

    local items = {"<< メニューに戻る"}
    for i, s in ipairs(STATUS) do
      local v = cur[i] and tostring(cur[i].value) or "?"
      table.insert(items, s.name .. "  [" .. v .. "]")
    end

    local sc = gg.choice(items, lastStatusPos, "ステータス一覧  対象: " .. #refined .. "件")

    if sc == nil then
      gg.setVisible(false)
    elseif sc == 1 then
      lastStatusPos = nil
      currentScreen = "main"
    else
      lastStatusPos = sc
      local i  = sc - 1
      local s  = STATUS[i]
      local cv = cur[i] and tostring(cur[i].value) or "0"
      local inp = gg.prompt({s.name .. " (offset " .. s.offset .. ")"}, {cv}, {"number"})
      if inp and inp[1] ~= nil then
        applyEdit(s.offset, inp[1])
        gg.toast("書き換えました")
      end
    end

  else

    local mc = gg.choice(
      MAIN_MENU,
      lastMainPos,
      "コストアドレス: " .. baseAddrHex .. "\\n対象: " .. #refined .. "件"
    )

    if mc == nil then
      gg.setVisible(false)
    elseif mc == 1 then
      lastMainPos   = mc
      currentScreen = "status"
    elseif mc == 2 then
      lastMainPos = mc
      for _, bk in ipairs(backup) do
        gg.setValues(bk.vals)
      end
      gg.toast("元の値に戻しました")
    elseif mc == 3 then
      lastMainPos = mc
      saveToList()
    elseif mc == 4 then
      local cf = gg.choice(CONFIRM_MENU, nil, "本当に終了しますか？")
      if cf == 1 then
        saveToList()
        gg.clearResults()
        os.exit()
      end
    end

  end

  while not gg.isVisible() do
    gg.sleep(500)
  end

end`;
}

// ============================================================
// コマンド本体
// ============================================================
const ggscript: Command = {
  name: "ggscript",
  description: "GG用ステータス変更Luaスクリプトを生成します",
  usage: "o.ggscript <検索値> <リファイン値> <cb|other> [キャラ名] [p:A1,B2...]",

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    if (args.length < 3) {
      const err = await channel.send(
        "❌ 使い方: `o.ggscript <検索値> <リファイン値> <cb|other> [キャラ名] [p:A1,B2...]`"
      );
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    const pattern = args[0];
    const refine = parseInt(args[1]);
    if (isNaN(refine)) {
      const err = await channel.send("❌ リファイン値は数値で指定してください");
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    const rangeArg = args[2].toLowerCase();
    if (rangeArg !== "cb" && rangeArg !== "other") {
      const err = await channel.send("❌ 検索範囲は `cb` か `other` を指定してください");
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }
    const range = rangeArg === "cb" ? "gg.REGION_C_BSS" : "gg.REGION_OTHER";

    // args[3]以降をjoinして キャラ名 と p:... を分離
    const rest = args.slice(3).join(" ");
    const pIdx = rest.search(/\bp:/);
    let charaName = "";
    let presets: PresetEntry[] = [];

    if (pIdx === -1) {
      charaName = rest.trim();
    } else {
      charaName = rest.slice(0, pIdx).trim();
      const presetStr = rest.slice(pIdx + 2).trim();
      presets = parsePreset(presetStr);
    }

    const lua = buildLua(pattern, refine, range, presets);
    const buf = Buffer.from(lua, "utf8");

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const filename = charaName
      ? `[${charaName}]ステータス変更スクリプト.lua`
      : `nyanko_${ts}.lua`;

    const file = new AttachmentBuilder(buf, { name: filename });
    const presetInfo = presets.length > 0 ? ` / プリセット ${presets.length}件` : "";
    await channel.send({
      content: `✅ スクリプト生成完了: \`${filename}\`${presetInfo}`,
      files: [file],
    });
  },
};

module.exports = ggscript;
