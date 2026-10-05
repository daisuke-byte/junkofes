import type { Sale, Session, Settings } from "../src/types";
import { computeChange, emptyDenoms, type ReceiveOption } from "../src/domain/money";
import { DEFAULT_SETTINGS } from "../src/db";

export const settings = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });

export const T0 = new Date(2026, 9, 25, 10, 0, 0);
export const at = (min: number) => new Date(T0.getTime() + min * 60000);

let n = 0;
export function sale(min: number, qty = 1, opt: ReceiveOption = "exact", p: Partial<Sale> = {}): Sale {
  const r = computeChange(qty, 400, opt);
  if (!r.ok) throw new Error("insufficient");
  return {
    id: `s${n++}`,
    sessionId: "x",
    createdAt: at(min).toISOString(),
    kind: "sale",
    qty,
    amount: r.total,
    received: r.received,
    change: r.change,
    receivedDenoms: r.receivedDenoms,
    changeDenoms: r.changeDenoms,
    voided: false,
    ...p,
  };
}

export function nonSale(min: number, kind: Sale["kind"], qty: number): Sale {
  return { ...sale(min, qty), kind, amount: 0, received: 0, change: 0, receivedDenoms: emptyDenoms(), changeDenoms: emptyDenoms() };
}

export const session = (p: Partial<Session> = {}): Session => ({
  id: "x",
  mode: "live",
  openedAt: T0.toISOString(),
  openingFloat: { ...emptyDenoms(), y500: 20, y100: 50 },
  locked: false,
  ...p,
});
