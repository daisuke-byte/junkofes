import "./style.css";
import { Database } from "./db";
import { salesCsv } from "./domain/csv";
import { testText } from "./domain/messages";
import { sumDenoms, yen, type ReceiveOption } from "./domain/money";
import { duration, hm, ymd } from "./domain/time";
import { playConfirm, playError, playFanfare, runFireworks, setMuted, unlockAudio } from "./effects";
import { isWebhookUrl, Notifier, slackTransport } from "./notify";
import { canvasToPdf } from "./pdf";
import { Store, type SaleEvent } from "./store";
import type { Mode } from "./types";
import { $, closeModal, esc, openModal, readDenoms, refreshDenomSubtotals, toast } from "./ui/dom";
import { drawReportCanvas, reportData } from "./ui/report";
import {
  closingScreen,
  historyScreen,
  openingScreen,
  registerScreen,
  reportScreen,
  settingsScreen,
  type UiState,
} from "./ui/screens";

type Route = "register" | "opening" | "history" | "closing" | "report" | "settings";

const app = $("#app")!;
const ui: UiState = { qty: 1, option: null, confirmed: null, saving: false, online: navigator.onLine, wakeLock: "off" };
let store: Store;
let notifier: Notifier;
let pdfFile: File | null = null;
let pdfUrl: string | null = null;

// --- ルーティング ---

function requestedRoute(): string {
  return location.hash.replace(/^#\/?/, "") || "";
}

/** 営業の段階に応じて表示できる画面を決める（一方向に進む） */
function resolveRoute(): Route {
  const want = requestedRoute();
  const allowed: Record<typeof store.phase, Route[]> = {
    setup: ["opening", "settings", "report"],
    open: ["register", "history", "report", "settings"],
    closing: ["closing", "history", "report", "settings"],
    closed: ["report", "settings", "history"],
  };
  const list = allowed[store.phase];
  return (list.includes(want as Route) ? want : list[0]) as Route;
}

let currentRoute: Route | null = null;

function render(force = false) {
  const route = resolveRoute();
  // 入力フォームのある画面は、入力中に再描画しない
  const formRoute = route === "opening" || route === "closing" || route === "settings";
  if (!force && formRoute && route === currentRoute) return;
  const changed = route !== currentRoute;
  currentRoute = route;
  document.body.dataset.route = route;
  const now = new Date();
  switch (route) {
    case "register":
      app.innerHTML = registerScreen(store, ui, now);
      break;
    case "opening":
      app.innerHTML = openingScreen(store);
      break;
    case "history":
      app.innerHTML = historyScreen(store);
      break;
    case "closing":
      app.innerHTML = closingScreen(store);
      refreshClosing();
      break;
    case "report":
      app.innerHTML = reportScreen(store, !!pdfFile);
      if (pdfUrl) $<HTMLAnchorElement>("#pdf-download")?.setAttribute("href", pdfUrl);
      if (pdfFile) $<HTMLAnchorElement>("#pdf-download")?.setAttribute("download", pdfFile.name);
      break;
    case "settings":
      app.innerHTML = settingsScreen(store);
      void showStorageInfo();
      break;
  }
  if (changed) window.scrollTo(0, 0);
}

function go(route: Route | "") {
  const h = `#/${route === "register" ? "" : route}`;
  if (location.hash !== h) location.hash = h;
  else render(true);
}

// --- 会計 ---

async function confirmSale() {
  if (ui.saving || !ui.option) return;
  ui.saving = true;
  render();
  try {
    const ev = await store.confirmSale(ui.qty, ui.option);
    ui.confirmed = ev.sale;
    ui.qty = 1;
    ui.option = null;
    playConfirm();
    afterSale(ev);
  } catch (e) {
    playError();
    toast(`保存に失敗したため確定していません：${(e as Error).message}`, "error");
  } finally {
    ui.saving = false;
    render();
  }
}

function afterSale(ev: SaleEvent) {
  if (ev.reachedGoal) setTimeout(() => celebrate(ev), 700);
  else if (ev.milestone) banner(`🎉 ${ev.milestone}杯 突破！`);
}

function banner(text: string) {
  const el = document.createElement("div");
  el.className = "milestone";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("out"), 2000);
  setTimeout(() => el.remove(), 2500);
}

// --- 達成演出 (F15) ---

function celebrate(ev: SaleEvent) {
  const { settings, session } = store.state;
  if (!session) return;
  const at = new Date(ev.sale.createdAt);
  const root = $("#celebrate-root")!;
  root.innerHTML = `<div class="celebrate" data-action="close-celebrate" role="dialog" aria-label="目標達成">
    <canvas></canvas>
    <div class="celebrate-text">
      <div class="c-sub">中村韓国キッチン</div>
      <div class="c-main">${settings.targetCount}杯達成！</div>
      <div class="c-time">${hm(at)} 達成・営業開始から ${duration(at.getTime() - Date.parse(session.openedAt))}</div>
      <div class="c-change">お釣り ${yen(ev.sale.change)}</div>
      <div class="c-tap">画面をタップして会計に戻る</div>
    </div>
  </div>`;
  root.hidden = false;
  const stop = runFireworks(root.querySelector("canvas")!, 5000);
  playFanfare();
  const close = () => {
    stop();
    root.hidden = true;
    root.innerHTML = "";
    clearTimeout(timer);
  };
  const timer = setTimeout(close, 8000);
  root.querySelector(".celebrate")!.addEventListener("click", close, { once: true });
}

// --- 取り消し ---

async function voidSale(id: string, isLast: boolean) {
  const s = store.state.sales.find((x) => x.id === id);
  if (!s) return;
  const desc = `${hm(new Date(s.createdAt))}　${s.qty}杯　${yen(s.amount)}（預かり ${yen(s.received)} / お釣り ${yen(s.change)}）${s.staff ? `　担当 ${s.staff}` : ""}`;
  const fd = await openModal(
    `<h2>${isLast ? "直前の会計を取り消す" : "会計を取り消す"}</h2>
     <p class="modal-desc">${esc(desc)}</p>
     <label class="field">取り消しの理由<input name="note" autocomplete="off" ${isLast ? 'value="打ち間違い"' : 'placeholder="例：杯数の打ち間違い"'} autofocus /></label>
     <p class="sub">現金を戻す場合：お客様に ${yen(s.amount)} を返金してください。</p>`,
    {
      submitLabel: "取り消す",
      danger: true,
      validate: (f) => (String(f.get("note") ?? "").trim() ? null : "理由を入力してください"),
    },
  );
  if (!fd) return;
  try {
    await store.voidSale(id, String(fd.get("note")).trim());
    if (ui.confirmed?.id === id) ui.confirmed = null;
    toast("取り消しました", "ok");
  } catch (e) {
    toast(`取り消しに失敗しました：${(e as Error).message}`, "error");
  }
  render(true);
}

// --- 金額入力（テンキー） ---

let padValue = "";

function padDisplay() {
  const out = $("#pad-display");
  if (out) out.textContent = `${Number(padValue || 0).toLocaleString("ja-JP")}円`;
  const input = $<HTMLInputElement>('#modal-root [name="amount"]');
  if (input) input.value = padValue;
}

async function inputAmount() {
  const total = ui.qty * store.state.settings.unitPrice;
  padValue = typeof ui.option === "number" ? String(ui.option) : "";
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "00", "0", "back"];
  const pending = openModal(
    `<h2>預かり金額を入力</h2>
     <p class="sub">合計 <b>${yen(total)}</b>（${ui.qty}杯）</p>
     <input type="hidden" name="amount" value="${padValue}" />
     <output class="pad-display" id="pad-display">0円</output>
     <div class="pad">
       ${keys.map((k) => `<button type="button" class="key pad-key" data-pad="${k}" ${k === "back" ? 'aria-label="1文字消す"' : ""}>${k === "back" ? "⌫" : k}</button>`).join("")}
     </div>
     <button type="button" class="btn small" data-pad="clear">クリア</button>`,
    {
      submitLabel: "この金額で決定",
      validate: (f) => {
        const n = Number(f.get("amount") || 0);
        if (!n) return "金額を入力してください";
        if (n % 10 !== 0) return "10円単位で入力してください";
        if (n < total) return `合計 ${yen(total)} より ${yen(total - n)} 少ないです`;
        return null;
      },
    },
  );
  padDisplay();
  const fd = await pending;
  if (!fd) return;
  ui.confirmed = null;
  ui.option = Number(fd.get("amount"));
  render();
}

// --- レジ担当者 ---

async function pickStaff() {
  const { staff, currentStaff } = store.state.settings;
  if (staff.length === 0) {
    const fd = await openModal(
      `<h2>レジ担当者</h2><p>担当者がまだ登録されていません。設定画面の「担当者」で名前を登録してください。</p>`,
      { submitLabel: "設定を開く" },
    );
    if (fd) go("settings");
    return;
  }
  const fd = await openModal(
    `<h2>レジ担当者を切り替える</h2>
     <div class="seg staff-seg">
       ${staff
         .map((n) => `<label><input type="radio" name="staff" value="${esc(n)}" ${n === currentStaff ? "checked" : ""}/><span>${esc(n)}</span></label>`)
         .join("")}
     </div>`,
    { submitLabel: "切り替える", validate: (f) => (f.get("staff") ? null : "担当者を選んでください") },
  );
  if (!fd) return;
  const name = String(fd.get("staff"));
  await store.updateSettings({ currentStaff: name });
  toast(`レジ担当を ${name} さんにしました`, "ok");
  render(true);
}

async function addStaff(form: HTMLFormElement) {
  const input = form.querySelector<HTMLInputElement>('[name="name"]')!;
  const name = input.value.trim();
  if (!name) return toast("名前を入力してください", "error");
  const { staff, currentStaff } = store.state.settings;
  if (staff.includes(name)) return toast(`${name} さんは登録済みです`, "error");
  await store.updateSettings({ staff: [...staff, name], currentStaff: currentStaff || name });
  toast(`${name} さんを登録しました`, "ok");
  render(true);
  $<HTMLInputElement>('#staff-form [name="name"]')?.focus();
}

async function removeStaff(i: number) {
  const { staff, currentStaff } = store.state.settings;
  const name = staff[i];
  if (name === undefined) return;
  const fd = await openModal(`<h2>${esc(name)} さんを削除しますか？</h2><p class="sub">これまでの会計に記録された名前は残ります。</p>`, {
    submitLabel: "削除",
    danger: true,
  });
  if (!fd) return;
  const next = staff.filter((_, j) => j !== i);
  await store.updateSettings({ staff: next, currentStaff: currentStaff === name ? (next[0] ?? "") : currentStaff });
  render(true);
}

// --- 営業開始・締め ---

async function openSession() {
  const float = readDenoms(app);
  const total = sumDenoms(float);
  const fd = await openModal(
    `<h2>この金額で営業開始しますか？</h2><p class="modal-big">準備金 ${yen(total)}</p>${
      total === 0 ? `<p class="sub strong">⚠ 準備金が0円です。お釣りが出せません。</p>` : ""
    }`,
    { submitLabel: "営業開始" },
  );
  if (!fd) return;
  try {
    await store.openSession(float);
    toast("営業を開始しました", "ok");
    go("register");
  } catch (e) {
    toast(`保存に失敗しました：${(e as Error).message}`, "error");
  }
}

async function startClosing() {
  const fd = await openModal(
    `<h2>営業を終了しますか？</h2><p>会計ボタンが止まり、レジ締めに進みます。<br>（締めを確定するまでは会計に戻れます）</p>`,
    { submitLabel: "営業終了してレジ締めへ", danger: true },
  );
  if (!fd) return;
  await store.startClosing();
  go("closing");
}

function refreshClosing() {
  const box = $("#close-summary");
  if (!box) return;
  const expected = Number(box.dataset.expected);
  const actual = refreshDenomSubtotals(app);
  const diff = actual - expected;
  $("#actual-total")!.textContent = yen(actual);
  const diffBox = $("#diff-box")!;
  diffBox.classList.toggle("ok", diff === 0);
  diffBox.classList.toggle("ng", diff !== 0);
  $("#diff-total")!.textContent = diff === 0 ? "0円 ✓ 一致" : `${diff > 0 ? "+" : "−"}${yen(Math.abs(diff))} ✕ ${diff > 0 ? "多い" : "足りない"}`;
  $("#diff-note-field")!.classList.toggle("required", diff !== 0);
}

async function closeSession() {
  const count = readDenoms(app);
  const expected = Number($("#close-summary")!.dataset.expected);
  const diff = sumDenoms(count) - expected;
  const note = $<HTMLTextAreaElement>("#diff-note")!.value.trim();
  const counter = $<HTMLInputElement>("#counter")!.value.trim();
  const checker = $<HTMLInputElement>("#checker")!.value.trim();
  const err = $("#close-error")!;
  if (diff !== 0 && !note) return void (err.textContent = "差額があるので理由を入力してください");
  if (!counter || !checker) return void (err.textContent = "数えた人と確認者の名前を入力してください");
  if (counter === checker) return void (err.textContent = "数えた人と確認者は別の人にしてください");
  err.textContent = "";
  const fd = await openModal(
    `<h2>締めを確定しますか？</h2>
     <p>実残高 ${yen(sumDenoms(count))}・差額 ${diff === 0 ? "0円（一致）" : `${diff > 0 ? "+" : "−"}${yen(Math.abs(diff))}`}</p>
     <p class="sub">確定すると会計データはロックされます。</p>`,
    { submitLabel: "締めを確定", danger: true },
  );
  if (!fd) return;
  try {
    await store.closeSession(count, note, counter, checker);
    toast("締めを確定しました", "ok");
    go("report");
  } catch (e) {
    toast(`保存に失敗しました：${(e as Error).message}`, "error");
  }
}

// --- 出力 ---

async function shareOrDownload(file: File) {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function fileStamp() {
  const s = store.state.session;
  const d = s ? new Date(s.openedAt) : new Date();
  return `${ymd(d)}${store.state.settings.mode === "practice" ? "_練習" : ""}`;
}

async function exportCsv() {
  const csv = salesCsv(store.state.sales);
  const file = new File([csv], `中村韓国キッチン_会計_${fileStamp()}.csv`, { type: "text/csv" });
  await shareOrDownload(file);
}

async function makePdf() {
  const { settings, session, sales } = store.state;
  if (!session) return;
  try {
    const cv = drawReportCanvas(reportData(settings, session, sales), store.phase === "closed");
    const blob = await canvasToPdf(cv);
    pdfFile = new File([blob], `中村韓国キッチン_レポート_${fileStamp()}.pdf`, { type: "application/pdf" });
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(pdfFile);
    toast("PDFを作成しました。「PDFを共有」からSlackへ送れます", "ok");
    render(true);
  } catch (e) {
    toast(`PDFの作成に失敗しました：${(e as Error).message}`, "error");
  }
}

// --- 設定 ---

async function saveSettings(form: HTMLFormElement) {
  const fd = new FormData(form);
  const num = (k: string) => Number(fd.get(k));
  const err = $("#settings-error")!;
  const unitPrice = num("unitPrice");
  const url = String(fd.get("slackWebhookUrl") ?? "").trim();
  if (!Number.isInteger(unitPrice) || unitPrice < 10 || unitPrice % 10 !== 0) return void (err.textContent = "単価は10円単位の整数にしてください");
  if (!Number.isInteger(num("targetCount")) || num("targetCount") < 1) return void (err.textContent = "目標杯数は1以上の整数にしてください");
  if (url && !isWebhookUrl(url)) return void (err.textContent = "Webhook URL は https://hooks.slack.com/ で始まるURLを入力してください");
  err.textContent = "";
  const muted = fd.get("muted") === "on";
  await store.updateSettings({
    unitPrice,
    targetCount: num("targetCount"),
    plannedCloseTime: String(fd.get("plannedCloseTime") ?? ""),
    slackWebhookUrl: url,
    coinWarn: { y100: Math.max(0, num("warn100") || 0), y500: Math.max(0, num("warn500") || 0) },
    muted,
  });
  setMuted(muted);
  toast("設定を保存しました", "ok");
  render(true);
}

async function testSlack() {
  const input = $<HTMLInputElement>('[name="slackWebhookUrl"]');
  const url = input?.value.trim() || store.state.settings.slackWebhookUrl;
  if (!url || !isWebhookUrl(url)) return toast("Webhook URL を入力してください", "error");
  const r = await notifier.sendNow(url, testText());
  if (r === "ok") toast("送信しました。Slack に届いたか確認してください", "ok");
  else if (r === "offline") toast("オフラインのため送信できません", "error");
  else toast("送信に失敗しました。URLと通信状態を確認してください", "error");
}

async function switchMode(mode: Mode) {
  if (mode === store.state.settings.mode) return;
  const fd = await openModal(
    `<h2>${mode === "practice" ? "練習モード" : "本番モード"}に切り替えますか？</h2>
     <p class="sub">${mode === "practice" ? "練習のデータは本番と別に保存され、画面に「練習中」と表示されます。" : "本番のデータに切り替わります。"}</p>`,
    { submitLabel: "切り替える" },
  );
  if (!fd) return;
  await store.updateSettings({ mode });
  ui.confirmed = null;
  ui.option = null;
  ui.qty = 1;
  pdfFile = null;
  toast(`${mode === "practice" ? "練習" : "本番"}モードにしました`, "ok");
  go("");
}

async function resetPractice() {
  const fd = await openModal(`<h2>練習データを消しますか？</h2><p class="sub">練習モードの会計・締めの記録をすべて削除します。本番データは消えません。</p>`, {
    submitLabel: "練習データを消す",
    danger: true,
  });
  if (!fd) return;
  await store.resetMode("practice");
  pdfFile = null;
  toast("練習データを消しました", "ok");
  go("");
}

async function resetLive() {
  const fd = await openModal(
    `<h2>本番データを全削除</h2>
     <p>本番の会計・締めの記録をすべて削除します。<b>元に戻せません。</b>先にCSVでバックアップしてください。</p>
     <label class="field">実行するには「リセット」と入力してください<input name="confirm" autocomplete="off" autofocus /></label>`,
    { submitLabel: "全削除", danger: true, validate: (f) => (String(f.get("confirm")).trim() === "リセット" ? null : "「リセット」と入力してください") },
  );
  if (!fd) return;
  await store.resetMode("live");
  pdfFile = null;
  toast("本番データを削除しました", "ok");
  go("");
}

async function unlock() {
  const fd = await openModal(
    `<h2>締めを解除しますか？</h2><p class="sub">会計を再開できるようになります。解除した記録は残ります。</p>
     <label class="field">解除の理由<input name="note" autocomplete="off" autofocus /></label>`,
    { submitLabel: "締めを解除", danger: true, validate: (f) => (String(f.get("note")).trim() ? null : "理由を入力してください") },
  );
  if (!fd) return;
  await store.unlockSession(String(fd.get("note")).trim());
  pdfFile = null;
  toast("締めを解除しました", "ok");
  go("register");
}

async function showStorageInfo() {
  const el = $("#storage-info");
  if (!el || !navigator.storage?.persisted) return;
  const persisted = await navigator.storage.persisted();
  el.textContent = persisted ? "この端末の保存領域は保護されています（自動削除されません）" : "保存領域は未保護です。ホーム画面に追加したアプリから使ってください。";
}

// --- イベント ---

app.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  const a = el.dataset.action;
  const routeNow = currentRoute;
  // 確定後の表示は次の操作で消す
  if (routeNow === "register" && (a === "qty" || a === "qty-step" || a === "recv")) ui.confirmed = null;
  switch (a) {
    case "qty":
      ui.qty = Number(el.dataset.n);
      return render();
    case "qty-step":
      ui.qty = Math.max(1, Math.min(99, ui.qty + Number(el.dataset.d)));
      return render();
    case "recv": {
      const v = el.dataset.opt!;
      ui.option = (v === "exact" ? "exact" : Number(v)) as ReceiveOption;
      return render();
    }
    case "confirm":
      return void confirmSale();
    case "void-last": {
      const last = store.lastActiveSale();
      if (last) void voidSale(last.id, true);
      return;
    }
    case "void":
      return void voidSale(el.dataset.id!, false);
    case "recv-input":
      return void inputAmount();
    case "pick-staff":
      return void pickStaff();
    case "staff-remove":
      return void removeStaff(Number(el.dataset.i));
    case "start-closing":
      return void startClosing();
    case "cancel-closing":
      return void store.cancelClosing().then(() => go("register"));
    case "close-session":
      return void closeSession();
    case "open-session":
      return void openSession();
    case "denom-step": {
      const input = app.querySelector<HTMLInputElement>(`[data-denom="${el.dataset.key}"]`)!;
      input.value = String(Math.max(0, (Number(input.value) || 0) + Number(el.dataset.delta)));
      return onDenomInput();
    }
    case "make-pdf":
      return void makePdf();
    case "share-pdf":
      if (pdfFile) void shareOrDownload(pdfFile);
      return;
    case "csv":
      return void exportCsv();
    case "test-slack":
      return void testSlack();
    case "flush-slack":
      return void notifier.flush().then(async (n) => {
        await store.refreshPending();
        toast(n ? `${n}件送信しました` : "送信できませんでした（オフラインまたはURL未設定）", n ? "ok" : "error");
        render(true);
      });
    case "mode":
      return void switchMode(el.dataset.mode as Mode);
    case "reset-practice":
      return void resetPractice();
    case "reset-live":
      return void resetLive();
    case "unlock":
      return void unlock();
  }
});

function onDenomInput() {
  if (currentRoute === "closing") refreshClosing();
  else $("#denom-total")!.textContent = yen(refreshDenomSubtotals(app));
}

app.addEventListener("input", (e) => {
  if ((e.target as HTMLElement).matches("[data-denom]")) onDenomInput();
});

app.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id === "settings-form") {
    e.preventDefault();
    void saveSettings(form);
  } else if (form.id === "staff-form") {
    e.preventDefault();
    void addStaff(form);
  }
});

$("#modal-root")!.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-action="modal-cancel"]')) return closeModal(null);
  const key = t.closest<HTMLElement>("[data-pad]")?.dataset.pad;
  if (key) {
    if (key === "back") padValue = padValue.slice(0, -1);
    else if (key === "clear") padValue = "";
    else if (padValue.length < 6) padValue = (padValue + key).replace(/^0+/, "");
    padDisplay();
  }
});

document.addEventListener("pointerdown", unlockAudio, { capture: true });
window.addEventListener("hashchange", () => render(true));
window.addEventListener("online", () => {
  ui.online = true;
  void notifier.flush().then(() => store.refreshPending());
  render();
});
window.addEventListener("offline", () => {
  ui.online = false;
  render();
});

// --- スリープ防止 (F09) ---

let wakeLock: WakeLockSentinel | null = null;
async function keepAwake() {
  if (!("wakeLock" in navigator)) {
    ui.wakeLock = "unsupported";
    return;
  }
  if (document.visibilityState !== "visible" || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    ui.wakeLock = "on";
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
      ui.wakeLock = "off";
      render();
    });
  } catch {
    ui.wakeLock = "off";
  }
  render();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void keepAwake();
    void store.tick().then(() => render());
  }
});
// 画面の一部のブラウザはユーザー操作後でないと取得できないため、タップ時にも再取得する
document.addEventListener("click", () => void keepAwake());

// --- 起動 ---

async function main() {
  // 誤操作で戻る・リロードしても状態は IndexedDB から復元される
  let db: Database;
  try {
    db = await Database.open();
  } catch (e) {
    app.innerHTML = `<main class="page narrow"><h1>データを開けません</h1><p>${esc((e as Error).message)}</p><p>プライベートブラウズでは使えません。アプリを開き直してください。</p></main>`;
    return;
  }
  notifier = new Notifier(db, slackTransport, () => store.state.settings.slackWebhookUrl);
  store = new Store(db, notifier);
  await store.load();
  setMuted(store.state.settings.muted);
  store.subscribe(() => render());
  render(true);

  void navigator.storage?.persist?.();
  void keepAwake();
  void store.tick().then(() => render());
  // 毎正時の判定と未送信分の再送（アプリが前面にある間）
  setInterval(() => void store.tick().then(() => render()), 60000);

  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW registration failed", e));
  }
}

void main();
