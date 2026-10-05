import type { Sale } from "../types";
import { KIND_LABEL } from "./stats";
import { dateTime } from "./time";

export const CSV_HEADER = ["日時", "種類", "杯数", "金額", "預かり", "お釣り", "取り消し", "取り消し理由"];

function cell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 全会計を1件1行で。Excel で文字化けしないよう BOM 付き UTF-8・CRLF */
export function salesCsv(sales: Sale[]): string {
  const rows = [...sales]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((s) => [
      dateTime(new Date(s.createdAt)),
      KIND_LABEL[s.kind],
      s.qty,
      s.amount,
      s.received,
      s.change,
      s.voided ? "取り消し" : "",
      s.voidNote ?? "",
    ]);
  return "﻿" + [CSV_HEADER, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
