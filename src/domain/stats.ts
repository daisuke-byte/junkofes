import type { Denoms, Sale, SaleKind, Session, Settings } from "../types";
import { addDenoms, subDenoms } from "./money";

export const COIN_DANGER = 5; // この枚数未満で赤の警告
export const STOCK_WARN = 20; // 残り在庫の警告
export const COUNTDOWN_FROM = 10; // 目標までのカウントダウン開始

export const KIND_LABEL: Record<SaleKind, string> = {
  sale: "販売",
  staff: "スタッフ食",
  sample: "試食",
  waste: "廃棄",
};

const t = (s: Sale) => Date.parse(s.createdAt);

export function activeSales(sales: Sale[]): Sale[] {
  return sales.filter((s) => !s.voided);
}

/** 理論残高（金種別）＝ 準備金 ＋ 預かり − お釣り（取り消し分は除く） */
export function expectedDrawer(float: Denoms, sales: Sale[]): Denoms {
  let d = { ...float };
  for (const s of sales) {
    if (s.voided || s.kind !== "sale") continue;
    d = subDenoms(addDenoms(d, s.receivedDenoms), s.changeDenoms);
  }
  return d;
}

export type Totals = {
  soldQty: number; // 販売杯数
  revenue: number; // 売上金額
  saleCount: number; // 会計件数
  consumedQty: number; // 在庫から減った杯数（売上外を含む）
  nonSale: Record<Exclude<SaleKind, "sale">, number>;
  voidCount: number;
};

export function totals(sales: Sale[]): Totals {
  const r: Totals = {
    soldQty: 0,
    revenue: 0,
    saleCount: 0,
    consumedQty: 0,
    nonSale: { staff: 0, sample: 0, waste: 0 },
    voidCount: 0,
  };
  for (const s of sales) {
    if (s.voided) {
      r.voidCount++;
      continue;
    }
    r.consumedQty += s.qty;
    if (s.kind === "sale") {
      r.soldQty += s.qty;
      r.revenue += s.amount;
      r.saleCount++;
    } else {
      r.nonSale[s.kind] += s.qty;
    }
  }
  return r;
}

/** 期間 (from, to] に売れた杯数 */
export function soldBetween(sales: Sale[], from: number, to: number): number {
  let n = 0;
  for (const s of sales) {
    if (s.voided || s.kind !== "sale") continue;
    const x = t(s);
    if (x > from && x <= to) n += s.qty;
  }
  return n;
}

/** 累計が target に達した会計の時刻 */
export function reachedAt(sales: Sale[], target: number): Date | null {
  const list = activeSales(sales)
    .filter((s) => s.kind === "sale")
    .sort((a, b) => t(a) - t(b));
  let cum = 0;
  for (const s of list) {
    cum += s.qty;
    if (cum >= target) return new Date(s.createdAt);
  }
  return null;
}

export type Slot = { start: Date; qty: number };

/** 30分ごとの販売杯数（営業開始の時刻を含む 30分枠から end まで） */
export function slots30(sales: Sale[], openedAt: Date, end: Date): Slot[] {
  const first = new Date(openedAt);
  first.setMinutes(first.getMinutes() < 30 ? 0 : 30, 0, 0);
  const out: Slot[] = [];
  const step = 30 * 60000;
  for (let s = first.getTime(); s <= end.getTime() && out.length < 96; s += step) {
    out.push({ start: new Date(s), qty: 0 });
  }
  if (out.length === 0) out.push({ start: first, qty: 0 });
  for (const s of sales) {
    if (s.voided || s.kind !== "sale") continue;
    const i = Math.floor((t(s) - first.getTime()) / step);
    if (i >= 0) {
      while (i >= out.length) out.push({ start: new Date(first.getTime() + out.length * step), qty: 0 });
      out[i].qty += s.qty;
    }
  }
  return out;
}

export function peakSlot(slots: Slot[]): Slot | null {
  let best: Slot | null = null;
  for (const s of slots) if (s.qty > 0 && (!best || s.qty > best.qty)) best = s;
  return best;
}

export type CoinLevel = "ok" | "warn" | "danger";
export type CoinWarning = { key: "y100" | "y500"; label: string; count: number; level: CoinLevel };

export function coinWarnings(drawer: Denoms, settings: Settings): CoinWarning[] {
  const out: CoinWarning[] = [];
  const check = (key: "y100" | "y500", label: string) => {
    const count = drawer[key];
    const level: CoinLevel = count < COIN_DANGER ? "danger" : count < settings.coinWarn[key] ? "warn" : "ok";
    if (level !== "ok") out.push({ key, label, count, level });
  };
  check("y100", "100円玉");
  check("y500", "500円玉");
  return out;
}

/** 残り在庫。仕込み数が 0（未設定）なら null */
export function remainingStock(settings: Settings, sales: Sale[]): number | null {
  if (!settings.stockCount) return null;
  return settings.stockCount - totals(sales).consumedQty;
}

/** 毎正時の定期報告の対象時間帯。まだ不要なら null */
export function dueHourlySlot(session: Session | null, now: Date): string | null {
  if (!session || session.locked || session.closingStartedAt) return null;
  const slot = new Date(now);
  slot.setMinutes(0, 0, 0);
  if (slot.getTime() <= Date.parse(session.openedAt)) return null;
  return `${String(slot.getHours()).padStart(2, "0")}:00`;
}
