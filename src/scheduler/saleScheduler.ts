import { Client, TextChannel } from "discord.js";
import { isHidden } from "../config/saleHiddenConfig";

// ================================
// URLs
// ================================
const SALE_JSON_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/sale.json";
const SALE_NAME_CSV_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/sale_name.csv";

// ================================
// 定数
// ================================
const JST_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

// ================================
// 型定義
// ================================
interface SaleHeader {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  minVersion: string;
  maxVersion: string;
}

interface DateRange {
  start: string;
  end: string;
}

interface TimeBlock {
  dateRanges: DateRange[];
  monthDays: number[];
  weekdays: string[];
  timeRanges: string[][];
}

interface SaleEntry {
  header: SaleHeader;
  timeBlocks: TimeBlock[];
  stageIds: number[];
  raw?: string;
}

interface SaleJson {
  updatedAt: string;
  data: SaleEntry[];
}

// ================================
// データキャッシュ
// ================================
let saleJson: SaleJson | null = null;
let nameMap = new Map<number, string>();

async function loadData(): Promise<void> {
  const [jsonRes, csvRes] = await Promise.all([
    fetch(SALE_JSON_URL),
    fetch(SALE_NAME_CSV_URL),
  ]);
  saleJson = (await jsonRes.json()) as SaleJson;

  const csvText = await csvRes.text();
  nameMap.clear();
  for (const line of csvText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const ci = t.indexOf(",");
    if (ci === -1) continue;
    const id = parseInt(t.slice(0, ci));
    if (!isNaN(id)) nameMap.set(id, t.slice(ci + 1).trim());
  }
}

// ================================
// 時刻ユーティリティ
// ================================

/** JST の現在時刻を返す（getUTC* でJST値を得る擬似Dateオブジェクト） */
function nowJST(): Date {
  return new Date(Date.now() + JST_MS);
}

/** "700" → 420, "2400" → 1440 (分単位) */
function parseTimeMin(s: string): number {
  const p = s.padStart(4, "0");
  return parseInt(p.slice(0, 2)) * 60 + parseInt(p.slice(2, 4));
}

function parseHeaderDate(dateStr: string, timeStr: string): Date {
  const d = dateStr.padStart(8, "0");
  const t = timeStr.padStart(4, "0");
  return new Date(
    `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:00+09:00`
  );
}

function isHeaderActive(header: SaleHeader, realNow: Date): boolean {
  const start = parseHeaderDate(header.startDate, header.startTime);
  const end = parseHeaderDate(header.endDate, header.endTime);
  return realNow >= start && realNow < end;
}

function isHeaderActiveOnDay(header: SaleHeader, targetJst: Date): boolean {
  // targetJst: getUTC* がJST値を返す擬似Date (時刻は 00:00 を想定)
  // その日の正午(JST)でヘッダーが有効かチェック
  const noonReal = new Date(targetJst.getTime() + 12 * 60 * 60 * 1000 - JST_MS);
  return (
    noonReal >= parseHeaderDate(header.startDate, header.startTime) &&
    noonReal < parseHeaderDate(header.endDate, header.endTime)
  );
}

// ================================
// dateRange パース
// ================================
function parseDRPValue(s: string): number {
  const parts = s.trim().split(" ");
  const mmdd = parts[0].padStart(4, "0");
  const month = parseInt(mmdd.slice(0, 2));
  const day = parseInt(mmdd.slice(2, 4));
  const mins = parseTimeMin((parts[1] ?? "0").padStart(4, "0"));
  return month * 100000 + day * 1440 + mins;
}

function matchesDateRange(range: DateRange, jst: Date): boolean {
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const mins = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const curr = month * 100000 + day * 1440 + mins;
  const s = parseDRPValue(range.start);
  const e = parseDRPValue(range.end);
  // 年をまたぐ場合（例: 12月→1月）
  return s <= e ? curr >= s && curr < e : curr >= s || curr < e;
}

// ================================
// timeBlock 条件判定
// ================================
function matchesDayCondition(block: TimeBlock, jst: Date): boolean {
  const { weekdays, monthDays, dateRanges } = block;
  if (weekdays.length === 0 && monthDays.length === 0 && dateRanges.length === 0) return true;
  if (weekdays.length > 0 && weekdays.some((w) => WEEKDAY_MAP[w] === jst.getUTCDay())) return true;
  if (monthDays.length > 0 && monthDays.includes(jst.getUTCDate())) return true;
  if (dateRanges.length > 0 && dateRanges.some((r) => matchesDateRange(r, jst))) return true;
  return false;
}

// ================================
// 名前取得（非表示除外済み）
// ================================
function getVisibleNames(ids: number[]): string[] {
  return ids
    .filter((id) => id >= 0 && !isHidden(id))
    .map((id) => nameMap.get(id) ?? null)
    .filter((n): n is string => n !== null);
}

// ================================
// 時刻フォーマット
// ================================
function formatMin(m: number): string {
  if (m >= 1440) return "24:00";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function formatDuration(startM: number, endM: number): string {
  const diff = endM - startM;
  if (diff <= 0) return "?";
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

// ================================
// チャンク送信ヘルパー（Discord 2000文字上限対応）
// ================================
async function sendChunked(
  channel: TextChannel,
  text: string,
  prefix = ""
): Promise<void> {
  const rawLines = text.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of rawLines) {
    const addition = current ? "\n" + line : line;
    if ((current + addition).length > 1800) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);

  for (let i = 0; i < chunks.length; i++) {
    // prefixは最初のチャンクのみ付与
    const hdr = i === 0 ? prefix : "";
    await channel.send(`${hdr}\`\`\`\n${chunks[i]}\n\`\`\``).catch(console.error);
  }
}

// ================================
// 指定JST日時に開始するイベントを検索
// ================================
interface StartingItem {
  id: number;
  name: string;
  startMin: number;
  endMin: number;
}

function findStartingAt(jst: Date): StartingItem[] {
  if (!saleJson) return [];

  const realNow = new Date(jst.getTime() - JST_MS);
  const currMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const results: StartingItem[] = [];

  for (const entry of saleJson.data) {
    if (!isHeaderActive(entry.header, realNow)) continue;
    if (entry.timeBlocks.length === 0) continue;

    for (const block of entry.timeBlocks) {
      if (!matchesDayCondition(block, jst)) continue;

      if (block.timeRanges.length === 0) {
        // 時間帯なし → 00:00 に通知
        if (currMin === 0) {
          for (const id of entry.stageIds.filter((id) => id >= 0 && !isHidden(id))) {
            const name = nameMap.get(id);
            if (name) results.push({ id, name, startMin: 0, endMin: 1440 });
          }
        }
      } else {
        for (const [sStr, eStr] of block.timeRanges) {
          const sMin = parseTimeMin(sStr);
          const eMin = parseTimeMin(eStr);
          if (sMin === currMin) {
            for (const id of entry.stageIds.filter((id) => id >= 0 && !isHidden(id))) {
              const name = nameMap.get(id);
              if (name) results.push({ id, name, startMin: sMin, endMin: eMin });
            }
          }
        }
      }
    }
  }

  // (id, startMin, endMin) で重複排除
  const seen = new Set<string>();
  return results.filter((item) => {
    const key = `${item.id}-${item.startMin}-${item.endMin}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ================================
// 指定JST日のスケジュール生成
// ================================
interface ScheduleSlot {
  startMin: number;
  endMin: number;
  names: string[];
}

function buildDaySchedule(targetJst: Date): ScheduleSlot[] {
  if (!saleJson) return [];

  const slots: ScheduleSlot[] = [];

  for (const entry of saleJson.data) {
    if (!isHeaderActiveOnDay(entry.header, targetJst)) continue;
    if (entry.timeBlocks.length === 0) continue;

    const names = getVisibleNames(entry.stageIds);
    if (names.length === 0) continue;

    for (const block of entry.timeBlocks) {
      if (!matchesDayCondition(block, targetJst)) continue;

      if (block.timeRanges.length === 0) {
        slots.push({ startMin: 0, endMin: 1440, names });
      } else {
        for (const [sStr, eStr] of block.timeRanges) {
          slots.push({
            startMin: parseTimeMin(sStr),
            endMin: parseTimeMin(eStr),
            names,
          });
        }
      }
    }
  }

  return slots;
}

function buildDailyText(targetJst: Date): string {
  const slots = buildDaySchedule(targetJst);

  // startMin → endMin → names のマップ（重複名を除去）
  const byStart = new Map<number, Map<number, Set<string>>>();
  for (const slot of slots) {
    if (!byStart.has(slot.startMin)) byStart.set(slot.startMin, new Map());
    const byEnd = byStart.get(slot.startMin)!;
    if (!byEnd.has(slot.endMin)) byEnd.set(slot.endMin, new Set());
    for (const n of slot.names) byEnd.get(slot.endMin)!.add(n);
  }

  const month = targetJst.getUTCMonth() + 1;
  const day = targetJst.getUTCDate();
  const wd = WEEKDAYS_JA[targetJst.getUTCDay()];
  const lines: string[] = [`${month}/${day}(${wd}) のイベント`, ""];

  for (const startMin of Array.from(byStart.keys()).sort((a, b) => a - b)) {
    lines.push(`[${formatMin(startMin)}]`);
    const byEnd = byStart.get(startMin)!;
    for (const endMin of Array.from(byEnd.keys()).sort((a, b) => a - b)) {
      const names = Array.from(byEnd.get(endMin)!);
      lines.push(`　～${formatMin(endMin)} ${names.join("、")}`);
    }
  }

  if (lines.length <= 2) {
    lines.push("　（イベントなし）");
  }

  return lines.join("\n");
}

// ================================
// スケジューラ本体
// ================================
export function startSaleScheduler(client: Client, channelId: string): void {
  let lastCheckedMinute = -1;

  const tick = async () => {
    try {
      const jst = nowJST();
      const currMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();

      // 同じ分は1回だけ処理
      if (currMin === lastCheckedMinute) return;
      lastCheckedMinute = currMin;

      // 毎時00分にデータ再取得
      if (jst.getUTCMinutes() === 0 || !saleJson) {
        await loadData().catch((e) => console.error("[Sale] データ取得エラー:", e));
      }

      const channel = client.channels.cache.get(channelId) as TextChannel | undefined;
      if (!channel) return;

      // 22:00 JST: 翌日スケジュール投稿
      if (jst.getUTCHours() === 22 && jst.getUTCMinutes() === 0) {
        try {
          const tomorrow = new Date(jst.getTime());
          tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
          tomorrow.setUTCHours(0, 0, 0, 0);
          const text = buildDailyText(tomorrow);
          await sendChunked(channel, text);
        } catch (e) {
          console.error("[Sale] 翌日スケジュール送信エラー:", e);
        }
      }

      // リアルタイム通知
      const starting = findStartingAt(jst);
      if (starting.length === 0) return;

      try {
        const lines = starting.map(
          (item) => `${item.id} ${item.name} (${formatDuration(item.startMin, item.endMin)})`
        );

        if (lines.length === 1) {
          await channel.send(`🔔 ${lines[0]}`).catch(console.error);
        } else {
          await sendChunked(channel, lines.join("\n"), "🔔 イベント開始\n");
        }
      } catch (e) {
        console.error("[Sale] リアルタイム通知エラー:", e);
      }
    } catch (e) {
      console.error("[Sale] スケジューラエラー:", e);
    }
  };

  loadData().catch((e) => console.error("[Sale] 初期データ取得エラー:", e));
  setInterval(tick, 30_000);
  tick();
}

// ================================
// "M/D" 形式をパース（例: "4/1" → {month:4, day:1}）
// ================================
function parseMMDD(str: string): { month: number; day: number } | null {
  const parts = str.split("/");
  if (parts.length !== 2) return null;
  const month = parseInt(parts[0]);
  const day = parseInt(parts[1]);
  if (
    isNaN(month) || isNaN(day) ||
    month < 1 || month > 12 ||
    day < 1 || day > 31
  ) return null;
  return { month, day };
}

/**
 * M/D + HH:MM を指定して擬似JST Dateを生成する
 * （getUTC* でJST値を得る擬似Dateオブジェクト）
 */
function makePseudoJST(month: number, day: number, hour: number, min: number): Date {
  const jst = nowJST();
  const year = jst.getUTCFullYear();
  // Date.UTC を使ってその年の M/D HH:MM を擬似JST値として生成
  return new Date(Date.UTC(year, month - 1, day, hour, min, 0));
}

// ================================
// デバッグ用エクスポート（sukesanping コマンドから呼ばれる）
//
// @param channel  送信先チャンネル
// @param arg      "d" | "HHMM" | undefined
// @param dateStr  "M/D" 形式の日付指定（省略可、例: "4/1"）
// ================================
export async function runPingTest(
  channel: TextChannel,
  arg: string | undefined,
  dateStr?: string
): Promise<void> {
  // 全体をtry-catchで囲みコマンドエラーにしない
  try {
    // データ未ロードなら先に取得
    if (!saleJson) {
      try {
        await loadData();
      } catch (e) {
        await channel.send("❌ データ取得に失敗しました").catch(() => void 0);
        return;
      }
    }

    // 日付指定をパース
    const parsedDate = dateStr ? parseMMDD(dateStr) : null;

    // ──────────────────────────────
    // "d" または引数なし → スケジュール表示
    // ──────────────────────────────
    if (!arg || arg.toLowerCase() === "d") {
      let targetJst: Date;

      if (parsedDate) {
        // 指定日の 00:00 JST（擬似）
        targetJst = makePseudoJST(parsedDate.month, parsedDate.day, 0, 0);
      } else {
        // 翌日の 00:00 JST（擬似）
        const jst = nowJST();
        targetJst = new Date(jst.getTime());
        targetJst.setUTCDate(targetJst.getUTCDate() + 1);
        targetJst.setUTCHours(0, 0, 0, 0);
      }

      const m = targetJst.getUTCMonth() + 1;
      const d = targetJst.getUTCDate();
      const text = buildDailyText(targetJst);
      await sendChunked(channel, text, `[TEST] ${m}/${d} のスケジュール\n`);
      return;
    }

    // ──────────────────────────────
    // HHMM → 指定時刻のイベント通知プレビュー
    // ──────────────────────────────
    const raw = arg.trim().padStart(4, "0");
    const h = parseInt(raw.slice(0, 2));
    const m = parseInt(raw.slice(2, 4));

    // 0000～2359 の範囲チェック（h=24は00:00扱いで通さない）
    if (isNaN(h) || isNaN(m) || h < 0 || h >= 24 || m < 0 || m > 59) {
      await channel.send("❌ 時刻は `0000`〜`2359` の形式で指定してください（例: `2100`）");
      return;
    }

    let fakeJst: Date;
    if (parsedDate) {
      // 指定日の HH:MM JST（擬似）
      fakeJst = makePseudoJST(parsedDate.month, parsedDate.day, h, m);
    } else {
      // 今日の HH:MM JST（擬似）
      const jst = nowJST();
      fakeJst = new Date(jst.getTime());
      fakeJst.setUTCHours(h, m, 0, 0);
    }

    const items = findStartingAt(fakeJst);
    const dateLabel = `${fakeJst.getUTCMonth() + 1}/${fakeJst.getUTCDate()}`;
    const timeLabel = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

    if (items.length === 0) {
      await channel.send(`[TEST] ${dateLabel} ${timeLabel} に開始するイベントはありません`);
      return;
    }

    const lines = items.map(
      (item) => `${item.id} ${item.name} (${formatDuration(item.startMin, item.endMin)})`
    );

    if (lines.length === 1) {
      await channel.send(`[TEST] 🔔 ${dateLabel} ${timeLabel}\n${lines[0]}`);
    } else {
      await sendChunked(
        channel,
        lines.join("\n"),
        `[TEST] 🔔 ${dateLabel} ${timeLabel} イベント開始\n`
      );
    }
  } catch (e) {
    // 予期しないエラーをコマンドエラーに伝播させず、チャンネルにエラーを返す
    console.error("[runPingTest] エラー:", e);
    await channel
      .send(`❌ 内部エラーが発生しました: ${e instanceof Error ? e.message : String(e)}`)
      .catch(() => void 0);
  }
}
