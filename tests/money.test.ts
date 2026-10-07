import { describe, expect, it } from "vitest";
import {
  breakdown,
  computeChange,
  describeDenoms,
  emptyDenoms,
  RECEIVE_OPTIONS,
  receivedFor,
  sumDenoms,
} from "../src/domain/money";

describe("お釣り計算と金種分解（1〜10杯 × 全預かりパターン）", () => {
  for (let qty = 1; qty <= 10; qty++) {
    for (const opt of RECEIVE_OPTIONS) {
      it(`${qty}杯 × 預かり ${opt}`, () => {
        const total = qty * 400;
        const r = computeChange(qty, 400, opt);
        const received = opt === "exact" ? total : opt;
        expect(r.total).toBe(total);
        expect(r.received).toBe(received);
        if (received < total) {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.shortage).toBe(total - received);
          return;
        }
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.change).toBe(received - total);
        expect(sumDenoms(r.changeDenoms)).toBe(r.change);
        expect(sumDenoms(r.receivedDenoms)).toBe(received);
        // 大きい金種から優先：同じ金種が「1つ上の金種」以上の金額にならない
        expect(r.changeDenoms.y100).toBeLessThan(5);
        expect(r.changeDenoms.y1000).toBeLessThan(5);
      });
    }
  }

  it("600円 → 500円玉×1、100円玉×1", () => {
    expect(describeDenoms(breakdown(600))).toBe("500円玉×1、100円玉×1");
  });

  it("1杯を1,000円で払うと 500円玉と100円玉が1枚ずつ出る", () => {
    const r = computeChange(1, 400, 1000);
    expect(r.ok && r.changeDenoms).toMatchObject({ y500: 1, y100: 1 });
  });

  it("1杯を10,000円で払うと 9,600円", () => {
    const r = computeChange(1, 400, 10000);
    expect(r.ok && r.change).toBe(9600);
    expect(r.ok && r.changeDenoms).toMatchObject({ y5000: 1, y1000: 4, y500: 1, y100: 1 });
  });

  it("「ちょうど」は100円玉で払われたものとみなす", () => {
    expect(receivedFor("exact", 1200).denoms).toMatchObject({ y100: 12 });
    expect(receivedFor("exact", 450).denoms).toMatchObject({ y100: 4, y50: 1 });
  });

  it("入力した金額は大きい金種から分解する", () => {
    expect(receivedFor(3000, 1200).denoms).toMatchObject({ y1000: 3 });
    expect(receivedFor(1500, 1200).denoms).toMatchObject({ y1000: 1, y500: 1 });
    expect(receivedFor(2400, 2400).denoms).toMatchObject({ y1000: 2, y100: 4 });
    const r = computeChange(3, 400, 1300);
    expect(r.ok && r.change).toBe(100);
  });

  it("2,000円は1,000円札×2", () => {
    expect(receivedFor(2000, 800).denoms).toMatchObject({ y1000: 2 });
  });

  it("500円玉が無いときは100円玉で払い出す", () => {
    const drawer = { ...emptyDenoms(), y100: 30 };
    const r = computeChange(1, 400, 1000, drawer);
    expect(r.ok && r.changeDenoms).toMatchObject({ y500: 0, y100: 6 });
  });

  it("小銭が足りないときも合計額は正しい", () => {
    const r = computeChange(1, 400, 1000, emptyDenoms());
    expect(r.ok && sumDenoms(r.changeDenoms)).toBe(600);
  });
});
