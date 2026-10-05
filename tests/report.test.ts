import { describe, expect, it } from "vitest";
import { salesCsv } from "../src/domain/csv";
import { peakSlot, reachedAt, slots30 } from "../src/domain/stats";
import { jpegToPdf } from "../src/pdf";
import { at, nonSale, sale, T0 } from "./helpers";

describe("CSV", () => {
  it("BOM付き・ヘッダーと1件1行", () => {
    const csv = salesCsv([sale(1, 2, 1000), sale(2, 1, 500, { voided: true, voidNote: '打ち間違い,"再入力"' }), nonSale(3, "staff", 1)]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("日時,種類,杯数,金額,預かり,お釣り,取り消し,取り消し理由");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("2026-10-25 10:01:00,販売,2,800,1000,200,,");
    expect(lines[2]).toBe('2026-10-25 10:02:00,販売,1,400,500,100,取り消し,"打ち間違い,""再入力"""');
    expect(lines[3]).toContain(",スタッフ食,1,0,0,0,,");
  });
});

describe("集計", () => {
  it("30分ごとの販売杯数とピーク", () => {
    const sales = [sale(5, 2), sale(20, 1), sale(35, 3), sale(40, 1), sale(70, 1)];
    const s = slots30(sales, T0, at(80));
    expect(s.map((x) => x.qty)).toEqual([3, 4, 1]);
    expect(peakSlot(s)?.start.getTime()).toBe(at(30).getTime());
  });

  it("達成時刻", () => {
    const sales = [sale(1, 200), sale(5, 100), sale(9, 3, "exact", { voided: true }), sale(10, 60)];
    expect(reachedAt(sales, 350)?.getTime()).toBe(at(10).getTime());
    expect(reachedAt(sales, 1000)).toBeNull();
  });
});

describe("PDF", () => {
  it("A4・1ページの PDF 構造になる", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = jpegToPdf(jpeg, 1240, 1754);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 1");
    expect(text).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // xref のオフセットが各オブジェクトの位置を指している
    const xrefPos = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefPos, xrefPos + 4)).toBe("xref");
    const offs = [...text.slice(xrefPos).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offs.forEach((o, i) => expect(text.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
  });
});
