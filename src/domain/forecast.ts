import type { Sale, Settings } from "../types";
import { soldBetween, totals } from "./stats";
import { hm, timeOnDay } from "./time";

export const FORECAST_MIN_SOLD = 20;
const WINDOW_MIN = 45;
const STALL_MIN = 15;

export type Forecast =
  | { kind: "measuring"; sold: number }
  | { kind: "stalled" }
  | { kind: "done" }
  | { kind: "eta"; at: Date; remaining: number; goal: number; pace: number }
  | { kind: "byClose"; projected: number; pace: number };

/**
 * 目標達成の予測（要件 6章 F14）
 * 予測時刻 = 現在時刻 + 残り杯数 ÷ 直近ペース（杯/分）
 * 直近ペースは直近45分の販売杯数から求める。開始から45分未満なら開始からの平均。
 */
export function forecast(sales: Sale[], settings: Settings, openedAt: Date, now: Date): Forecast {
  const sold = totals(sales).soldQty;
  const goal = settings.targetCount;
  const remaining = goal - sold;

  if (remaining <= 0) return { kind: "done" };
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
    return { kind: "byClose", projected: Math.floor(sold + pace * minsLeft), pace };
  }
  return { kind: "eta", at, remaining, goal, pace };
}

/** 画面・Slack 用の文言 */
export function forecastText(f: Forecast, target: number): string {
  switch (f.kind) {
    case "measuring":
      return "計測中";
    case "stalled":
      return "ペース低下中";
    case "done":
      return `${target}杯達成！`;
    case "eta":
      return `このペースなら ${hm(f.at)} に${f.goal}杯達成（あと ${f.remaining}杯）`;
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
      return "目標達成";
    case "eta":
      return `達成予測 ${hm(f.at)}`;
    case "byClose":
      return `終了時 約${f.projected}杯`;
  }
}
