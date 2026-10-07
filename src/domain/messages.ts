import type { Sale, Session, Settings } from "../types";
import { forecast, forecastText } from "./forecast";
import { sumDenoms, yen } from "./money";
import { soldBetween, totals } from "./stats";
import { duration, hm } from "./time";

export const SHOP = "中村韓国キッチン";

const prefix = (s: Settings) => (s.mode === "practice" ? "【練習】" : "");
const pct = (sold: number, target: number) => (target > 0 ? Math.floor((sold / target) * 100) : 0);

export function openText(settings: Settings, session: Session): string {
  return `${prefix(settings)}🍲 ${SHOP} 営業開始\n開始 ${hm(new Date(session.openedAt))}\n準備金 ${yen(sumDenoms(session.openingFloat))}`;
}

export function hourlyText(settings: Settings, session: Session, sales: Sale[], now: Date, slot: string): string {
  const tot = totals(sales);
  const lines = [
    `${prefix(settings)}🍲 ${SHOP} ${slot} の状況`,
    `累計 ${tot.soldQty}杯 / ${yen(tot.revenue)}（目標 ${pct(tot.soldQty, settings.targetCount)}%）`,
    `直近1時間 ${soldBetween(sales, now.getTime() - 3600000, now.getTime())}杯`,
  ];
  const f = forecast(sales, settings, new Date(session.openedAt), now);
  if (f.kind === "eta") lines.push(`達成予測 ${hm(f.at)} ごろ`);
  else lines.push(`予測 ${forecastText(f, settings.targetCount)}`);
  return lines.join("\n");
}

export function goalText(settings: Settings, session: Session, at: Date): string {
  return `${prefix(settings)}🎉 ${SHOP} ${settings.targetCount}杯達成！\n達成時刻 ${hm(at)}\n営業開始から ${duration(at.getTime() - Date.parse(session.openedAt))}`;
}

export function closeText(settings: Settings, session: Session, sales: Sale[]): string {
  const tot = totals(sales);
  const diff = session.diff ?? 0;
  const diffStr = diff === 0 ? "0円（一致）" : `${diff > 0 ? "+" : "−"}${yen(Math.abs(diff))}`;
  return [
    `${prefix(settings)}🏁 ${SHOP} 営業終了`,
    `最終 ${tot.soldQty}杯 / ${yen(tot.revenue)}（目標比 ${pct(tot.soldQty, settings.targetCount)}%）`,
    `締めの差額 ${diffStr}`,
    `確認 ${session.counter ?? ""}・${session.checker ?? ""}`,
  ].join("\n");
}

export function testText(): string {
  return `🍲 ${SHOP} 会計アプリからのテスト送信です（${hm(new Date())}）`;
}
