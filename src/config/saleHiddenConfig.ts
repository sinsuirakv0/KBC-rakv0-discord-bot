// ============================================================
// sale 非表示設定（常設イベントなど）
// デフォルトで非表示にしたいIDを設定する
//
// ranges: { from, to } の形式で範囲指定
// ids:    個別IDを指定
//
// 設定例:
//   ranges: [{ from: -4, to: 999 }],  // -4〜999を非表示
//   ids: [6000, 12000],               // 個別IDを非表示
// ============================================================
export const SALE_HIDDEN_CONFIG = {
  ranges: [
    { from: 8000, to: 10999 },
    { from: 15000, to: 15999 },
    { from: 14000, to: 14999 },
    { from: 17000, to: 17999 },
    { from: 1269, to: 1281 },
  ] as { from: number; to: number }[],
  ids: [1313,1334,1346,1312,1333,1345,1314,1335,1347,1257,1258,1266,1268,1265,1255,1256] as number[],
};

/** IDが非表示設定に該当するか */
export function isHidden(id: number): boolean {
  for (const r of SALE_HIDDEN_CONFIG.ranges) {
    if (id >= r.from && id <= r.to) return true;
  }
  return SALE_HIDDEN_CONFIG.ids.includes(id);
}
