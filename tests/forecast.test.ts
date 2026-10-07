import { describe, expect, it } from "vitest";
import { forecast, forecastText } from "../src/domain/forecast";
import { at, sale, settings, T0 } from "./helpers";

// 毎分1杯ずつ売れたことにする
const steady = (from: number, to: number, qty = 1) => {
  const out = [];
  for (let m = from; m < to; m++) out.push(sale(m + 0.5, qty));
  return out;
};

describe("完売予測", () => {
  const s = settings({ plannedCloseTime: "18:00" });

  it("20杯未満は計測中", () => {
    const f = forecast(steady(0, 19), s, T0, at(19));
    expect(f.kind).toBe("measuring");
    expect(forecastText(f, 350)).toBe("計測中");
  });

  it("直近15分の販売が0杯ならペース低下中（時刻は出さない）", () => {
    const f = forecast(steady(0, 30), s, T0, at(46));
    expect(f.kind).toBe("stalled");
    expect(forecastText(f, 350)).toBe("ペース低下中");
  });

  it("45分未満は開始からの平均ペース", () => {
    const f = forecast(steady(0, 30), s, T0, at(30)); // 1杯/分
    expect(f.kind).toBe("eta");
    if (f.kind !== "eta") return;
    expect(f.pace).toBeCloseTo(1);
    expect(f.remaining).toBe(320);
    expect(f.at.getTime()).toBe(at(30 + 320).getTime());
    expect(forecastText(f, 350)).toBe("このペースなら 15:50 に350杯達成（あと 320杯）");
  });

  it("45分以降は直近45分のペース", () => {
    // 最初の60分は1杯/分、その後45分は2杯/分
    const sales = [...steady(0, 60), ...steady(60, 105, 2)];
    const f = forecast(sales, s, T0, at(105));
    expect(f.kind).toBe("eta");
    if (f.kind !== "eta") return;
    expect(f.pace).toBeCloseTo(2);
    expect(f.remaining).toBe(350 - 150);
  });

  it("予測が営業終了予定を過ぎるなら終了時点の見込み杯数", () => {
    const f = forecast(steady(0, 30), settings({ plannedCloseTime: "12:00" }), T0, at(30));
    expect(f.kind).toBe("byClose");
    if (f.kind !== "byClose") return;
    expect(f.projected).toBe(30 + 90); // 12:00 まで残り90分 × 1杯/分
    expect(forecastText(f, 350)).toBe("終了までに約 120杯の見込み");
  });

  it("目標に達したら done", () => {
    const f = forecast([sale(1, 350)], s, T0, at(2));
    expect(f.kind).toBe("done");
  });
});
