import { sumDenoms, yen } from "../domain/money";
import { SHOP } from "../domain/messages";
import { peakSlot, reachedAt, slots30, staffTotals, totals, type Slot, type StaffTotal } from "../domain/stats";
import { duration, hm, ymdJa } from "../domain/time";
import type { Sale, Session, Settings } from "../types";
import { esc } from "./dom";

export type ReportData = {
  date: Date;
  openedAt: Date;
  closedAt: Date | null;
  end: Date;
  soldQty: number;
  revenue: number;
  pct: number;
  target: number;
  targetRevenue: number;
  slots: Slot[];
  peak: Slot | null;
  goalAt: Date | null;
  float: number;
  expectedCash?: number;
  actualCash?: number;
  diff?: number;
  diffNote?: string;
  counter?: string;
  checker?: string;
  staff: StaffTotal[];
  voidCount: number;
  saleCount: number;
  practice: boolean;
  unlockCount: number;
};

export function reportData(settings: Settings, session: Session, sales: Sale[], now = new Date()): ReportData {
  const tot = totals(sales);
  const openedAt = new Date(session.openedAt);
  const closedAt = session.closedAt ? new Date(session.closedAt) : null;
  const end = closedAt ?? now;
  const slots = slots30(sales, openedAt, end);
  return {
    date: openedAt,
    openedAt,
    closedAt,
    end,
    soldQty: tot.soldQty,
    revenue: tot.revenue,
    pct: settings.targetCount ? Math.floor((tot.soldQty / settings.targetCount) * 100) : 0,
    target: settings.targetCount,
    targetRevenue: settings.targetCount * settings.unitPrice,
    slots,
    peak: peakSlot(slots),
    goalAt: reachedAt(sales, settings.targetCount),
    float: sumDenoms(session.openingFloat),
    expectedCash: session.expectedCash,
    actualCash: session.closingCount ? sumDenoms(session.closingCount) : undefined,
    diff: session.diff,
    diffNote: session.diffNote,
    counter: session.counter,
    checker: session.checker,
    staff: staffTotals(sales),
    voidCount: tot.voidCount,
    saleCount: tot.saleCount,
    practice: session.mode === "practice",
    unlockCount: session.unlockLog?.length ?? 0,
  };
}

const slotLabel = (s: Slot) => hm(s.start);
const signed = (n: number) => (n === 0 ? "0円" : `${n > 0 ? "+" : "−"}${yen(Math.abs(n))}`);

/** 時間帯別グラフ (F18) を SVG で */
export function chartSvg(slots: Slot[]): string {
  const W = 720;
  const H = 260;
  const padL = 36;
  const padB = 46;
  const max = Math.max(5, ...slots.map((s) => s.qty));
  const step = Math.ceil(max / 4 / 5) * 5 || 5;
  const top = step * 4;
  const bw = (W - padL - 8) / slots.length;
  const y = (v: number) => H - padB - (v / top) * (H - padB - 14);
  const grid = [0, 1, 2, 3, 4]
    .map((i) => `<line x1="${padL}" x2="${W}" y1="${y(i * step)}" y2="${y(i * step)}" class="grid"/><text x="${padL - 6}" y="${y(i * step) + 4}" class="axis" text-anchor="end">${i * step}</text>`)
    .join("");
  const bars = slots
    .map((s, i) => {
      const x = padL + i * bw + bw * 0.15;
      const w = bw * 0.7;
      const label = i % Math.ceil(slots.length / 12) === 0 ? `<text x="${x + w / 2}" y="${H - padB + 18}" class="axis" text-anchor="middle">${slotLabel(s)}</text>` : "";
      const val = s.qty > 0 ? `<text x="${x + w / 2}" y="${y(s.qty) - 4}" class="val" text-anchor="middle">${s.qty}</text>` : "";
      return `<rect x="${x}" y="${y(s.qty)}" width="${w}" height="${H - padB - y(s.qty)}" class="bar" rx="3"><title>${slotLabel(s)} ${s.qty}杯</title></rect>${val}${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="30分ごとの販売杯数">${grid}${bars}<text x="${W - 4}" y="${H - 6}" class="axis" text-anchor="end">（30分ごと・杯）</text></svg>`;
}

export function reportHtml(d: ReportData, closed: boolean): string {
  const rows: [string, string][] = [
    ["営業時間", `${hm(d.openedAt)} 〜 ${d.closedAt ? hm(d.closedAt) : "営業中"}（${duration(d.end.getTime() - d.openedAt.getTime())}）`],
    ["会計件数", `${d.saleCount}件（取り消し ${d.voidCount}件）`],
    ["ピーク時間帯", d.peak ? `${hm(d.peak.start)}〜 ${d.peak.qty}杯` : "—"],
    [`${d.target}杯の達成`, d.goalAt ? `${hm(d.goalAt)}（開始から ${duration(d.goalAt.getTime() - d.openedAt.getTime())}）` : `未達（最終 ${d.soldQty}杯）`],
    ["担当者別", d.staff.length ? d.staff.map((s) => `${esc(s.name)} ${s.qty}杯（${s.count}件）`).join("・") : "—"],
    ["準備金", yen(d.float)],
  ];
  if (closed) {
    rows.push(
      ["理論残高", yen(d.expectedCash ?? 0)],
      ["実残高", yen(d.actualCash ?? 0)],
      ["差額", `${signed(d.diff ?? 0)}${d.diffNote ? `（${esc(d.diffNote)}）` : ""}`],
      ["確認者", `${esc(d.counter)}（数えた人）・${esc(d.checker)}（確認者）`],
    );
  }
  if (d.unlockCount) rows.push(["締めの解除", `${d.unlockCount}回`]);
  return `
    <div class="report-kpis">
      <div class="kpi-big"><span>最終杯数</span><b>${d.soldQty}<small>杯</small></b></div>
      <div class="kpi-big"><span>売上金額</span><b>${d.revenue.toLocaleString("ja-JP")}<small>円</small></b></div>
      <div class="kpi-big"><span>目標比</span><b>${d.pct}<small>%</small></b></div>
    </div>
    <h3>時間帯別の販売杯数</h3>
    ${chartSvg(d.slots)}
    <table class="report-table">${rows
      .map(([k, v]) => `<tr><th>${k}</th><td class="${k === "差額" && d.diff ? "ng" : ""}">${v}</td></tr>`)
      .join("")}</table>`;
}

/** PDF 用に A4 縦（150dpi 相当）の Canvas にレポートを描く */
export function drawReportCanvas(d: ReportData, closed: boolean): HTMLCanvasElement {
  const W = 1240;
  const H = 1754;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  const font = (px: number, weight = 400) => `${weight} ${px}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif`;
  const M = 90;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, W, H);

  // 丹青風の帯
  const band = ["#C8321E", "#0E7C66", "#F2B705", "#1D3A8A"];
  band.forEach((col, i) => {
    c.fillStyle = col;
    c.fillRect((W / band.length) * i, 0, W / band.length, 18);
  });

  c.fillStyle = "#111";
  c.textBaseline = "alphabetic";
  c.font = font(54, 700);
  c.fillText(`${SHOP} 売上レポート${d.practice ? "（練習）" : ""}`, M, 120);
  c.font = font(28);
  c.fillStyle = "#444";
  c.fillText(
    `順煌祭 ${ymdJa(d.date)}　営業時間 ${hm(d.openedAt)}〜${d.closedAt ? hm(d.closedAt) : "（営業中・暫定）"}`,
    M,
    168,
  );

  // 大きな数字
  const kpis: [string, string, string][] = [
    ["最終杯数", String(d.soldQty), "杯"],
    ["売上金額", d.revenue.toLocaleString("ja-JP"), "円"],
    ["目標比", String(d.pct), "%"],
  ];
  const kw = (W - M * 2 - 40) / 3;
  kpis.forEach(([label, val, unit], i) => {
    const x = M + i * (kw + 20);
    c.fillStyle = "#F6F3EC";
    c.fillRect(x, 210, kw, 190);
    c.fillStyle = band[i];
    c.fillRect(x, 210, 10, 190);
    c.fillStyle = "#444";
    c.font = font(28, 700);
    c.fillText(label, x + 36, 260);
    c.fillStyle = "#111";
    c.font = font(88, 800);
    c.fillText(val, x + 36, 365);
    const vw = c.measureText(val).width;
    c.font = font(36, 700);
    c.fillText(unit, x + 46 + vw, 365);
  });
  c.font = font(24);
  c.fillStyle = "#555";
  c.fillText(`目標 ${d.target}杯 / ${yen(d.targetRevenue)}`, M, 440);

  // グラフ
  c.fillStyle = "#111";
  c.font = font(32, 700);
  c.fillText("時間帯別の販売杯数（30分ごと）", M, 510);
  const gx = M + 50;
  const gy = 540;
  const gw = W - M * 2 - 50;
  const gh = 400;
  const max = Math.max(5, ...d.slots.map((s) => s.qty));
  const step = Math.ceil(max / 4 / 5) * 5 || 5;
  const top = step * 4;
  c.strokeStyle = "#ddd";
  c.lineWidth = 2;
  c.font = font(22);
  for (let i = 0; i <= 4; i++) {
    const yy = gy + gh - (i / 4) * gh;
    c.beginPath();
    c.moveTo(gx, yy);
    c.lineTo(gx + gw, yy);
    c.stroke();
    c.fillStyle = "#666";
    c.textAlign = "right";
    c.fillText(String(i * step), gx - 10, yy + 8);
  }
  const bw = gw / d.slots.length;
  const every = Math.ceil(d.slots.length / 12);
  d.slots.forEach((s, i) => {
    const h = (s.qty / top) * gh;
    const x = gx + i * bw + bw * 0.15;
    c.fillStyle = d.peak && s.start.getTime() === d.peak.start.getTime() ? "#C8321E" : "#0E7C66";
    c.fillRect(x, gy + gh - h, bw * 0.7, h);
    c.textAlign = "center";
    if (s.qty > 0) {
      c.fillStyle = "#111";
      c.font = font(22, 700);
      c.fillText(String(s.qty), x + bw * 0.35, gy + gh - h - 8);
    }
    if (i % every === 0) {
      c.fillStyle = "#555";
      c.font = font(21);
      c.fillText(hm(s.start), x + bw * 0.35, gy + gh + 32);
    }
  });
  c.textAlign = "left";

  // 詳細表
  const rows: [string, string][] = [
    ["ピーク時間帯", d.peak ? `${hm(d.peak.start)}〜（${d.peak.qty}杯）` : "—"],
    [`${d.target}杯の達成`, d.goalAt ? `${hm(d.goalAt)}（営業開始から ${duration(d.goalAt.getTime() - d.openedAt.getTime())}）` : `未達（最終 ${d.soldQty}杯）`],
    ["会計件数", `${d.saleCount}件　取り消し ${d.voidCount}件`],
    ["担当者別", d.staff.length ? d.staff.map((s) => `${s.name} ${s.qty}杯`).join("　") : "—"],
    ["準備金", yen(d.float)],
  ];
  if (closed) {
    rows.push(
      ["理論残高", yen(d.expectedCash ?? 0)],
      ["実残高", yen(d.actualCash ?? 0)],
      ["差額", `${signed(d.diff ?? 0)}${d.diff === 0 ? "（一致）" : ""}${d.diffNote ? `　理由：${d.diffNote}` : ""}`],
      ["確認者", `数えた人 ${d.counter ?? ""}　確認者 ${d.checker ?? ""}`],
    );
  } else {
    rows.push(["レジ締め", "未実施（暫定レポート）"]);
  }
  if (d.unlockCount) rows.push(["締めの解除", `${d.unlockCount}回`]);
  let ry = 1040;
  c.fillStyle = "#111";
  c.font = font(32, 700);
  c.fillText(closed ? "レジ締めの結果・記録" : "記録", M, ry);
  ry += 24;
  const rh = 56;
  rows.forEach(([k, v], i) => {
    if (i % 2 === 0) {
      c.fillStyle = "#F6F3EC";
      c.fillRect(M, ry, W - M * 2, rh);
    }
    c.fillStyle = "#555";
    c.font = font(26, 700);
    c.fillText(k, M + 20, ry + 38);
    c.fillStyle = k === "差額" && d.diff ? "#B3261E" : "#111";
    c.font = font(28, k === "差額" ? 700 : 400);
    let text = v;
    while (c.measureText(text).width > W - M * 2 - 320 && text.length > 4) text = text.slice(0, -2) + "…";
    c.fillText(text, M + 300, ry + 38);
    ry += rh;
  });

  c.fillStyle = "#888";
  c.font = font(20);
  c.fillText(`作成 ${ymdJa(new Date())} ${hm(new Date())}　${SHOP} 会計アプリ`, M, H - 50);
  return cv;
}
