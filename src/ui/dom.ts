import { DENOM_KEYS, DENOM_LABEL, DENOM_VALUE, emptyDenoms, sumDenoms, yen } from "../domain/money";
import type { Denoms } from "../types";

export function esc(s: string | number | undefined | null): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);

/** 金種ごとの枚数入力（営業開始・レジ締めで共用） */
export function denomInputs(values: Denoms = emptyDenoms()): string {
  return `<div class="denoms">
    ${DENOM_KEYS.map(
      (k) => `<div class="denom-row">
        <label for="d-${k}">${DENOM_LABEL[k]}</label>
        <button type="button" class="step" data-action="denom-step" data-key="${k}" data-delta="-1" aria-label="${DENOM_LABEL[k]}を1枚減らす">−</button>
        <input id="d-${k}" class="denom-input" data-denom="${k}" type="number" inputmode="numeric" min="0" step="1" value="${values[k] || ""}" placeholder="0" />
        <button type="button" class="step" data-action="denom-step" data-key="${k}" data-delta="1" aria-label="${DENOM_LABEL[k]}を1枚増やす">＋</button>
        <output class="denom-sub" data-sub="${k}">${yen(values[k] * DENOM_VALUE[k])}</output>
      </div>`,
    ).join("")}
  </div>`;
}

export function readDenoms(root: ParentNode = document): Denoms {
  const d = emptyDenoms();
  for (const k of DENOM_KEYS) {
    const el = root.querySelector<HTMLInputElement>(`[data-denom="${k}"]`);
    const n = Math.floor(Number(el?.value || 0));
    d[k] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return d;
}

/** 入力に合わせて小計を更新し、合計を返す */
export function refreshDenomSubtotals(root: ParentNode = document): number {
  const d = readDenoms(root);
  for (const k of DENOM_KEYS) {
    const out = root.querySelector(`[data-sub="${k}"]`);
    if (out) out.textContent = yen(d[k] * DENOM_VALUE[k]);
  }
  return sumDenoms(d);
}

// --- モーダル ---

let modalResolve: ((v: FormData | null) => void) | null = null;

/** フォーム付きモーダルを開き、送信されたら FormData、閉じたら null を返す */
export function openModal(
  html: string,
  opts: { submitLabel?: string; danger?: boolean; cancelLabel?: string; validate?: (fd: FormData) => string | null } = {},
): Promise<FormData | null> {
  closeModal(null);
  const root = $("#modal-root")!;
  root.innerHTML = `<div class="modal-backdrop" data-action="modal-cancel"></div>
    <form class="modal" role="dialog" aria-modal="true" novalidate>
      ${html}
      <p class="modal-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="modal-cancel">${opts.cancelLabel ?? "やめる"}</button>
        ${opts.submitLabel ? `<button type="submit" class="btn ${opts.danger ? "danger" : "primary"}">${opts.submitLabel}</button>` : ""}
      </div>
    </form>`;
  root.hidden = false;
  const form = root.querySelector("form")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const err = opts.validate?.(fd);
    if (err) {
      form.querySelector(".modal-error")!.textContent = err;
      return;
    }
    closeModal(fd);
  });
  (form.querySelector("[autofocus]") as HTMLElement | null)?.focus();
  return new Promise((resolve) => (modalResolve = resolve));
}

export function closeModal(v: FormData | null) {
  const root = $("#modal-root");
  if (root) {
    root.hidden = true;
    root.innerHTML = "";
  }
  const r = modalResolve;
  modalResolve = null;
  r?.(v);
}

// --- トースト ---

/** 通知を1つだけ表示する（前の通知は消す。画面を覆い続けないように） */
export function toast(msg: string, kind: "info" | "error" | "ok" = "info", ms = kind === "error" ? 4000 : 1800) {
  const root = $("#toast-root")!;
  root.replaceChildren();
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.classList.add("out"), ms);
  setTimeout(() => el.remove(), ms + 400);
}
