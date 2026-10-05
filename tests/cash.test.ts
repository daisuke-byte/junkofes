import { describe, expect, it } from "vitest";
import { sumDenoms } from "../src/domain/money";
import { coinWarnings, expectedDrawer, totals } from "../src/domain/stats";
import { nonSale, sale, session, settings } from "./helpers";

describe("理論残高（準備金 + 会計 − 取り消し）", () => {
  const float = session().openingFloat; // 500円玉20, 100円玉50 = 15,000円

  it("会計がなければ準備金のまま", () => {
    expect(sumDenoms(expectedDrawer(float, []))).toBe(15000);
  });

  it("会計の分だけ増え、金種も追跡される", () => {
    const sales = [sale(1, 1, 1000), sale(2, 2, 1000), sale(3, 1, 500), sale(4, 3, "exact")];
    const d = expectedDrawer(float, sales);
    expect(sumDenoms(d)).toBe(15000 + 400 * 7);
    expect(d.y1000).toBe(2);
    expect(d.y500).toBe(20 - 1 + 1); // 1,000円払いで500円玉が出て、500円払いで入る
    expect(d.y100).toBe(50 - 1 - 2 - 1 + 12); // お釣り600円・200円・100円で出て、ちょうど(3杯)で12枚入る
  });

  it("取り消した会計は含めない", () => {
    const sales = [sale(1, 1, 1000), sale(2, 2, 1000, { voided: true })];
    expect(sumDenoms(expectedDrawer(float, sales))).toBe(15400);
    expect(totals(sales)).toMatchObject({ soldQty: 1, revenue: 400, voidCount: 1 });
  });

  it("売上外は現金に影響しないが在庫は減る", () => {
    const sales = [sale(1, 2), nonSale(2, "staff", 3), nonSale(3, "waste", 1)];
    expect(sumDenoms(expectedDrawer(float, sales))).toBe(15800);
    const t = totals(sales);
    expect(t.soldQty).toBe(2);
    expect(t.consumedQty).toBe(6);
    expect(t.nonSale).toEqual({ staff: 3, sample: 0, waste: 1 });
  });

  it("小銭の警告：100円玉20枚未満で黄、5枚未満で赤", () => {
    const s = settings();
    const base = { ...session().openingFloat };
    expect(coinWarnings({ ...base, y100: 20, y500: 10 }, s)).toEqual([]);
    expect(coinWarnings({ ...base, y100: 19, y500: 10 }, s)[0]).toMatchObject({ key: "y100", level: "warn" });
    expect(coinWarnings({ ...base, y100: 4, y500: 10 }, s)[0]).toMatchObject({ key: "y100", level: "danger" });
    expect(coinWarnings({ ...base, y100: 30, y500: 9 }, s)[0]).toMatchObject({ key: "y500", level: "warn" });
  });
});
