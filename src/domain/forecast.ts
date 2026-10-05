import type { Sale, Settings } from "../types";
import { soldBetween, totals } from "./stats";
import { hm, timeOnDay } from "./time";

export const FORECAST_MIN_SOLD = 20;
const WINDOW_MIN = 45;
const STALL_MIN = 15;

export type GoalKind = "target" | "soldout";

export type Forecast =
  | { kind: "measuring"; sold: number }
  | { kind: "stalled" }
  | { kind: "done"; goalKind: GoalKind }
  | { kind: "eta"; at: Date; remaining: number; goal: number; goalKind: GoalKind; pace: number }
  | { kind: "byClose"; projected: number; goalKind: GoalKind; pace: number };

/**
 * 完売予測（要件 6章 F14）
 * 予測時刻 = 現在時刻 + 残り杯数 ÷ 直近ペース（杯/分）
 * 直近ペースは直近45分の販売杯数から求める。開始から45分未満なら開始からの平均。
 * 仕込み数が目標より少なければ、目標達成ではなく売り切れを予測する。
 */
export function forecast(sales: Sale[], settings: Settings, openedAt: Date, now: Date): Forecast {
  const tot = totals(sales);
  const sold = tot.soldQty;
  const stock = settings.stockCount;
  const goalKind: GoalKind = stock > 0 && stock < settings.targetCount ? "soldout" : "target";
  // 残り：目標までの杯数、または売り切れまでの在庫（売上外も在庫を減らす）
  const remaining = goalKind === "soldout" ? stock - tot.consumedQty : settings.targetCount - sold;
  const goal = goalKind === "soldout" ? stock : settings.targetCount;

  if (remaining <= 0) return { kind: "done", goalKind };
  if (sold < FORECAST_MIN_SOLD) return { kind: "measuring", sold };

  const nowMs = now.getTime();
  if (soldBetween(sales, nowMs - STALL_MIN * 60000, nowMs) === 0) return { kind: "stalled" };

  const elapsedMin = (nowMs - openedAt.getTime()) / 60000;
  const windowMin = Math.max(1, Math.min(WINDOW_MIN, elapsedMin));
  const pace = soldBetween(sales, nowMs - windowMin * 60000, nowMs) / windowMin;
  if (pace <= 0) return { kind: "stalled" };

  const at = new Date(nowMs + (remaining / pace) * 60000);
  const close = settings.plannedCloseTime ? timeOnDay(now, settings.plannedCloseTime) : null;
  if (close && at > close) {
    const minsLeft = Math.max(0, (close.getTime() - nowMs) / 60000);
    const projected = Math.floor(sold + pace * minsLeft);
    return { kind: "byClose", projected, goalKind, pace };
  }
  return { kind: "eta", at, remaining, goal, goalKind, pace };
}

/** 画面・Slack 用の文言 */
export function forecastText(f: Forecast, target: number): string {
  switch (f.kind) {
    case "measuring":
      return "計測中";
    case "stalled":
      return "ペース低下中";
    case "done":
      return f.goalKind === "soldout" ? "売り切れ" : `${target}杯達成！`;
    case "eta":
      return f.goalKind === "soldout"
        ? `このペースなら ${hm(f.at)} に売り切れ（あと ${f.remaining}杯）`
        : `このペースなら ${hm(f.at)} に${f.goal}杯達成（あと ${f.remaining}杯）`;
    case "byClose":
      return `終了までに約 ${f.projected}杯の見込み`;
  }
}

/** 上部バー用の短い文言 */
export function forecastShort(f: Forecast): string {
  switch (f.kind) {
    case "measuring":
      return "予測 計測中";
    case "stalled":
      return "ペース低下中";
    case "done":
      return f.goalKind === "soldout" ? "売り切れ" : "目標達成";
    case "eta":
      return `${f.goalKind === "soldout" ? "売切" : "達成"}予測 ${hm(f.at)}`;
    case "byClose":
      return `終了時 約${f.projected}杯`;
  }
}
