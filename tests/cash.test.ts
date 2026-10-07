import { describe, expect, it } from "vitest";
import { sumDenoms } from "../src/domain/money";
import { crossedMilestone, expectedDrawer, staffTotals, totals } from "../src/domain/stats";
import { nonSale, sale, session } from "./helpers";

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

  it("旧版の売上外の記録は集計にも現金にも含めない", () => {
    const sales = [sale(1, 2), nonSale(2, "staff", 3), nonSale(3, "waste", 1)];
    expect(sumDenoms(expectedDrawer(float, sales))).toBe(15800);
    expect(totals(sales)).toMatchObject({ soldQty: 2, saleCount: 1, voidCount: 0 });
  });

  it("担当者ごとの集計", () => {
    const sales = [sale(1, 2, "exact", { staff: "山田" }), sale(2, 1, "exact", { staff: "佐藤" }), sale(3, 3, "exact", { staff: "山田" }), sale(4, 5, "exact", { staff: "佐藤", voided: true })];
    expect(staffTotals(sales)).toEqual([
      { name: "山田", qty: 5, revenue: 2000, count: 2 },
      { name: "佐藤", qty: 1, revenue: 400, count: 1 },
    ]);
  });

  it("キリ番の判定", () => {
    expect(crossedMilestone(9, 10, 10, 350)).toBe(10);
    expect(crossedMilestone(8, 12, 10, 350)).toBe(10);
    expect(crossedMilestone(10, 11, 10, 350)).toBeNull();
    expect(crossedMilestone(18, 31, 10, 350)).toBe(30); // 2つまたいだら大きい方
    expect(crossedMilestone(345, 350, 10, 350)).toBeNull(); // 目標ちょうどは達成演出
    expect(crossedMilestone(355, 360, 10, 350)).toBe(360); // 達成後も続く
    expect(crossedMilestone(9, 10, 0, 350)).toBeNull(); // 演出なし
    expect(crossedMilestone(48, 52, 25, 350)).toBe(50);
  });
});
