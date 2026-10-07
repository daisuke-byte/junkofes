import type { Denoms } from "../types";

export const DENOM_KEYS = ["y10000", "y5000", "y1000", "y500", "y100", "y50", "y10"] as const;
export type DenomKey = (typeof DENOM_KEYS)[number];

export const DENOM_VALUE: Record<DenomKey, number> = {
  y10000: 10000,
  y5000: 5000,
  y1000: 1000,
  y500: 500,
  y100: 100,
  y50: 50,
  y10: 10,
};

export const DENOM_LABEL: Record<DenomKey, string> = {
  y10000: "10,000円札",
  y5000: "5,000円札",
  y1000: "1,000円札",
  y500: "500円玉",
  y100: "100円玉",
  y50: "50円玉",
  y10: "10円玉",
};

export function emptyDenoms(): Denoms {
  return { y10000: 0, y5000: 0, y1000: 0, y500: 0, y100: 0, y50: 0, y10: 0 };
}

export function sumDenoms(d: Denoms): number {
  return DENOM_KEYS.reduce((s, k) => s + DENOM_VALUE[k] * d[k], 0);
}

export function addDenoms(a: Denoms, b: Denoms): Denoms {
  const r = emptyDenoms();
  for (const k of DENOM_KEYS) r[k] = a[k] + b[k];
  return r;
}

export function subDenoms(a: Denoms, b: Denoms): Denoms {
  const r = emptyDenoms();
  for (const k of DENOM_KEYS) r[k] = a[k] - b[k];
  return r;
}

/**
 * 金額を大きい金種から優先して分解する。
 * available を渡すと、レジ内にある枚数を超えないように分解し、
 * 足りない分は（実際には両替が必要な状態として）制約なしで補う。
 */
export function breakdown(amount: number, available?: Denoms): Denoms {
  const r = emptyDenoms();
  let rest = amount;
  for (const k of DENOM_KEYS) {
    const v = DENOM_VALUE[k];
    let n = Math.floor(rest / v);
    if (available) n = Math.min(n, Math.max(0, available[k]));
    r[k] = n;
    rest -= n * v;
  }
  if (rest > 0 && available) return addDenoms(r, breakdown(rest));
  return r;
}

/** 「500円玉×1、100円玉×1」形式（0枚の金種は省く） */
export function describeDenoms(d: Denoms): string {
  return DENOM_KEYS.filter((k) => d[k] > 0)
    .map((k) => `${DENOM_LABEL[k]}×${d[k]}`)
    .join("、");
}

/** 預かり。exact は「ちょうど」、数値は預かった金額（ボタンまたは金額入力） */
export type ReceiveOption = "exact" | number;
export const RECEIVE_OPTIONS: ReceiveOption[] = ["exact", 500, 1000, 2000, 5000, 10000];

/**
 * 預かった金額を金種に対応させる（要件 5章）。
 * 「ちょうど」は 100円玉で払われたものとみなす（端数は 50円・10円玉）。
 * それ以外は大きい金種から分解する（2,000円は 1,000円札×2、3,000円は ×3 など）。
 */
export function receivedFor(option: ReceiveOption, total: number): { amount: number; denoms: Denoms } {
  const d = emptyDenoms();
  if (option === "exact") {
    d.y100 = Math.floor(total / 100);
    let rest = total - d.y100 * 100;
    d.y50 = Math.floor(rest / 50);
    rest -= d.y50 * 50;
    d.y10 = Math.floor(rest / 10);
    return { amount: total, denoms: d };
  }
  return { amount: option, denoms: breakdown(option) };
}

export type ChangeResult =
  | { ok: true; total: number; received: number; change: number; receivedDenoms: Denoms; changeDenoms: Denoms }
  | { ok: false; total: number; received: number; shortage: number };

/** 会計 1件分のお釣りを計算する。drawer は会計前のレジ内の理論上の枚数。 */
export function computeChange(qty: number, unitPrice: number, option: ReceiveOption, drawer?: Denoms): ChangeResult {
  const total = qty * unitPrice;
  const { amount, denoms } = receivedFor(option, total);
  if (amount < total) return { ok: false, total, received: amount, shortage: total - amount };
  const change = amount - total;
  // 受け取ったお金もレジに入ってからお釣りを出す
  const avail = drawer ? addDenoms(drawer, denoms) : undefined;
  return { ok: true, total, received: amount, change, receivedDenoms: denoms, changeDenoms: breakdown(change, avail) };
}

export function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}
