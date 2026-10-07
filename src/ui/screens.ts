import { forecast, forecastShort, forecastText } from "../domain/forecast";
import { computeChange, describeDenoms, RECEIVE_OPTIONS, sumDenoms, yen, type ReceiveOption } from "../domain/money";
import { COUNTDOWN_FROM, totals } from "../domain/stats";
import { hm, hms } from "../domain/time";
import type { Store } from "../store";
import type { Sale } from "../types";
import { denomInputs, esc } from "./dom";
import { reportData, reportHtml } from "./report";

export type UiState = {
  qty: number;
  option: ReceiveOption | null;
  confirmed: Sale | null; // 直前に確定した会計（次の操作まで表示）
  saving: boolean;
  online: boolean;
  wakeLock: "on" | "off" | "unsupported";
};

const ICON_WARN = `<span class="ico" aria-hidden="true">⚠</span>`;

const optLabel = (o: ReceiveOption) => (o === "exact" ? "ちょうど" : o.toLocaleString("ja-JP"));

export function practiceBanner(store: Store): string {
  return store.state.settings.mode === "practice" ? `<div class="practice-banner" role="status">🧪 練習中（本番データとは別に保存されています）</div>` : "";
}

// --- 上部バー（累計・進捗・予測） ---

function topBar(store: Store, now: Date): string {
  const { settings, session, sales } = store.state;
  const tot = totals(sales);
  const pctRaw = settings.targetCount ? (tot.soldQty / settings.targetCount) * 100 : 0;
  const pct = Math.floor(pctRaw);
  const f = session ? forecast(sales, settings, new Date(session.openedAt), now) : null;
  return `<header class="topbar">
    <div class="tb-total"><b>${tot.soldQty}</b>杯 / ${yen(tot.revenue)}</div>
    <div class="tb-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, pct)}" aria-label="目標に対する進捗">
      <div class="tb-bar"><div class="tb-fill ${pct >= 100 ? "over" : ""}" style="width:${Math.min(100, pctRaw)}%"></div></div>
      <span>${pct >= 100 ? `目標比 ${pct}%` : `${pct}%`}</span>
    </div>
    <div class="tb-forecast" title="${f ? esc(forecastText(f, settings.targetCount)) : ""}">${f ? esc(forecastShort(f)) : ""}</div>
  </header>`;
}

function countdown(store: Store): string {
  const { settings, sales } = store.state;
  const left = settings.targetCount - totals(sales).soldQty;
  if (left < 1 || left > COUNTDOWN_FROM) return "";
  return `<div class="countdown" role="status"><span>${settings.targetCount}杯まで</span><b>あと ${left}杯</b></div>`;
}

// --- 会計（メイン） ---

export function registerScreen(store: Store, ui: UiState, now: Date): string {
  const { settings, sales } = store.state;
  const closing = store.phase !== "open";
  const total = ui.qty * settings.unitPrice;
  const r = ui.option ? computeChange(ui.qty, settings.unitPrice, ui.option) : null;
  const f = store.state.session ? forecast(sales, settings, new Date(store.state.session.openedAt), now) : null;

  const qtyBtns = [1, 2, 3, 4, 5]
    .map((n) => `<button class="key qty ${ui.qty === n ? "on" : ""}" data-action="qty" data-n="${n}" aria-pressed="${ui.qty === n}">${n}</button>`)
    .join("");
  const custom = ui.option !== null && !RECEIVE_OPTIONS.includes(ui.option);
  const recvBtns =
    RECEIVE_OPTIONS.map((o) => {
      const amount = o === "exact" ? total : o;
      const short = amount < total;
      return `<button class="key recv ${ui.option === o ? "on" : ""} ${short ? "short" : ""}" data-action="recv" data-opt="${o}" aria-pressed="${ui.option === o}">
      ${optLabel(o)}${o === "exact" ? `<small>${yen(total)}</small>` : short ? `<small>不足</small>` : ""}</button>`;
    }).join("") +
    `<button class="key recv input ${custom ? "on" : ""}" data-action="recv-input" aria-pressed="${custom}">
      ${custom ? `${(ui.option as number).toLocaleString("ja-JP")}<small>金額を入力（変更）</small>` : `金額を入力<small>テンキー</small>`}</button>`;

  let result: string;
  if (ui.confirmed && !ui.option) {
    const c = ui.confirmed;
    result = `<div class="res-done" role="status">✓ 確定しました（${c.qty}杯）</div>
      <dl class="res-lines"><dt>合計</dt><dd>${yen(c.amount)}</dd><dt>預かり</dt><dd>${yen(c.received)}</dd></dl>
      <div class="change"><span>お釣り</span><b>${c.change.toLocaleString("ja-JP")}<small>円</small></b></div>
      <div class="change-denoms">${c.change ? esc(describeDenoms(c.changeDenoms)) : "お釣りなし"}</div>
      <p class="hint">次のお客様の杯数・預かりを選んでください</p>`;
  } else {
    const changeHtml = !r
      ? `<div class="change muted"><span>お釣り</span><b>−</b></div><p class="hint">預かり金額を選んでください</p>`
      : !r.ok
        ? `<div class="change short" role="alert"><span>不足</span><b>${r.shortage.toLocaleString("ja-JP")}<small>円</small></b></div><p class="hint strong">${ICON_WARN}あと ${yen(r.shortage)} 足りません</p>`
        : `<div class="change"><span>お釣り</span><b>${r.change.toLocaleString("ja-JP")}<small>円</small></b></div>
           <div class="change-denoms">${r.change ? esc(describeDenoms(r.changeDenoms)) : "お釣りなし"}</div>`;
    result = `<dl class="res-lines"><dt>合計</dt><dd>${yen(total)}</dd><dt>預かり</dt><dd>${r ? yen(r.received) : "—"}</dd></dl>${changeHtml}`;
  }
  const canConfirm = !closing && !ui.saving && !!r && r.ok;

  return `${practiceBanner(store)}${topBar(store, now)}${countdown(store)}
  <main class="register ${closing ? "is-closing" : ""}">
    <section class="reg-input" aria-label="入力">
      <div class="field-label">杯数</div>
      <div class="qty-row">${qtyBtns}</div>
      <div class="qty-adj">
        <button class="key small" data-action="qty-step" data-d="-1" aria-label="1杯減らす" ${ui.qty <= 1 ? "disabled" : ""}>−</button>
        <output class="qty-now">${ui.qty}<small>杯</small></output>
        <button class="key small" data-action="qty-step" data-d="1" aria-label="1杯増やす">＋</button>
      </div>
      <div class="field-label">預かり</div>
      <div class="recv-grid">${recvBtns}</div>
    </section>
    <section class="reg-result" aria-label="結果" aria-live="polite">
      ${result}
      <button class="confirm" data-action="confirm" ${canConfirm ? "" : "disabled"}>${ui.saving ? "保存中…" : "確定"}</button>
    </section>
  </main>
  <footer class="reg-footer">
    <button class="btn" data-action="void-last" ${store.lastActiveSale() && !closing ? "" : "disabled"}>直前を取り消す</button>
    <a class="btn" href="#/history">履歴</a>
    <button class="btn end" data-action="start-closing">営業終了</button>
    ${staffButton(store)}
    <div class="footer-info">
      <span class="fc-text">${f ? esc(forecastText(f, settings.targetCount)) : ""}</span>
    </div>
    ${statusIcons(store, ui)}
    <a class="btn icon" href="#/report" aria-label="レポート">📊</a>
    <a class="btn icon" href="#/settings" aria-label="設定">⚙️</a>
  </footer>`;
}

/** いまのレジ担当者。押すと切り替え */
export function staffButton(store: Store): string {
  const name = store.state.settings.currentStaff;
  return `<button class="btn staff ${name ? "" : "unset"}" data-action="pick-staff" aria-label="レジ担当者を切り替える">
    <span class="staff-label">担当</span><b>${name ? esc(name) : "未設定"}</b></button>`;
}

function statusIcons(store: Store, ui: UiState): string {
  const items: string[] = [];
  if (!ui.online) items.push(`<span class="st off">オフライン</span>`);
  if (store.state.pendingNotices > 0) items.push(`<span class="st">Slack未送信 ${store.state.pendingNotices}</span>`);
  if (ui.wakeLock === "off") items.push(`<span class="st off" title="画面の自動ロックを「なし」にしてください">画面点灯OFF</span>`);
  return items.length ? `<div class="status">${items.join("")}</div>` : "";
}

// --- 営業開始 ---

export function openingScreen(store: Store): string {
  const { settings } = store.state;
  return `${practiceBanner(store)}
  <main class="page narrow">
    <h1>営業開始</h1>
    <p class="lead">釣り銭の準備金を金種ごとに数えて入力してください。</p>
    ${denomInputs()}
    <div class="total-line">準備金の合計 <output id="denom-total">0円</output></div>
    <button class="btn primary xl" data-action="open-session">この金額で営業開始</button>
    <div class="row opening-staff">レジ担当者 ${staffButton(store)}</div>
    <p class="sub">単価 ${yen(settings.unitPrice)}・目標 ${settings.targetCount}杯
      ${settings.slackWebhookUrl ? "" : "・<b>Slack未設定</b>"}　<a href="#/settings">設定を開く</a></p>
  </main>`;
}

// --- 履歴 ---

export function historyScreen(store: Store): string {
  const { sales } = store.state;
  const closed = store.phase === "closed";
  const tot = totals(sales);
  const rows = [...sales]
    .reverse()
    .map((s) => {
      const t = new Date(s.createdAt);
      return `<tr class="${s.voided ? "voided" : ""} kind-${s.kind}">
        <td>${hms(t)}</td>
        <td>${esc(s.staff) || "—"}</td>
        <td class="num">${s.qty}杯</td>
        <td class="num">${yen(s.amount)}</td>
        <td class="num">${yen(s.received)}</td>
        <td class="num">${yen(s.change)}</td>
        <td>${s.voided ? `<span class="tag tag-void">取り消し</span> <small>${esc(s.voidNote)}${s.voidedAt ? `（${hm(new Date(s.voidedAt))}）` : ""}</small>` : ""}</td>
        <td>${!s.voided && !closed ? `<button class="btn small" data-action="void" data-id="${s.id}">取り消す</button>` : ""}</td>
      </tr>`;
    })
    .join("");
  return `${practiceBanner(store)}
  <main class="page">
    <div class="page-head">
      <a class="btn" href="#/">← 戻る</a>
      <h1>履歴</h1>
      <span></span>
    </div>
    <p class="sub">販売 ${tot.soldQty}杯 / ${yen(tot.revenue)}・会計 ${tot.saleCount}件・取り消し ${tot.voidCount}件</p>
    ${
      sales.length
        ? `<div class="table-wrap"><table class="history"><thead><tr><th>時刻</th><th>担当</th><th>杯数</th><th>金額</th><th>預かり</th><th>お釣り</th><th>メモ</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="empty">まだ会計はありません</p>`
    }
  </main>`;
}

// --- レジ締め ---

export function closingScreen(store: Store): string {
  const expected = sumDenoms(store.drawer());
  const tot = totals(store.state.sales);
  return `${practiceBanner(store)}
  <main class="page narrow">
    <div class="page-head">
      <button class="btn" data-action="cancel-closing">← 会計に戻る</button>
      <h1>レジ締め</h1><span></span>
    </div>
    <p class="lead">会計は停止中です。レジの中の現金を金種ごとに数えて入力してください。</p>
    <p class="sub">販売 ${tot.soldQty}杯 / ${yen(tot.revenue)}・準備金 ${yen(sumDenoms(store.state.session!.openingFloat))}</p>
    ${denomInputs()}
    <div class="close-summary" id="close-summary" data-expected="${expected}">
      <div><span>理論残高</span><b>${yen(expected)}</b></div>
      <div><span>実残高</span><b id="actual-total">0円</b></div>
      <div class="diff" id="diff-box"><span>差額</span><b id="diff-total">—</b></div>
    </div>
    <label class="field" id="diff-note-field">差額の理由（差額がある場合は必須）
      <textarea name="diffNote" id="diff-note" rows="2" placeholder="例：お釣りの渡し間違いの可能性"></textarea></label>
    <div class="two">
      <label class="field">数えた人<input id="counter" list="staff-list" autocomplete="off" placeholder="名前" /></label>
      <label class="field">確認者<input id="checker" list="staff-list" autocomplete="off" placeholder="名前（別の人）" /></label>
    </div>
    <datalist id="staff-list">${store.state.settings.staff.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
    <p class="form-error" id="close-error" role="alert"></p>
    <button class="btn primary xl" data-action="close-session">締めを確定</button>
  </main>`;
}

// --- レポート ---

export function reportScreen(store: Store, pdfReady: boolean): string {
  const { settings, session, sales } = store.state;
  if (!session) return `<main class="page"><p class="empty">まだ営業データがありません</p><a class="btn" href="#/">戻る</a></main>`;
  const closed = store.phase === "closed";
  const d = reportData(settings, session, sales);
  return `${practiceBanner(store)}
  <main class="page report">
    <div class="page-head">
      ${closed ? `<span></span>` : `<a class="btn" href="#/">← 戻る</a>`}
      <h1>レポート${closed ? "" : "（営業中・暫定）"}</h1>
      <a class="btn icon" href="#/settings" aria-label="設定">⚙️</a>
    </div>
    <div class="report-actions">
      <button class="btn primary" data-action="make-pdf">PDFを作成</button>
      ${pdfReady ? `<button class="btn primary" data-action="share-pdf">PDFを共有（Slackへ）</button><a class="btn" id="pdf-download" download>PDFを保存</a>` : ""}
      <button class="btn" data-action="csv">CSV出力</button>
      <a class="btn" href="#/history">履歴</a>
    </div>
    ${reportHtml(d, closed)}
    ${
      closed
        ? `<p class="sub">締めは確定済みです。会計を再開する場合は 設定 →「締めを解除」。${
            settings.mode === "practice" ? `<br><button class="btn" data-action="reset-practice">練習データを消して最初から</button>` : ""
          }</p>`
        : ""
    }
  </main>`;
}

// --- 設定 ---

export function settingsScreen(store: Store): string {
  const { settings: s, session } = store.state;
  const closed = store.phase === "closed";
  const back = store.phase === "setup" ? "#/" : closed ? "#/report" : "#/";
  return `${practiceBanner(store)}
  <main class="page narrow settings">
    <div class="page-head"><a class="btn" href="${back}">← 戻る</a><h1>設定</h1><span></span></div>
    <form id="settings-form" class="card" novalidate>
      <h2>販売</h2>
      <div class="two">
        <label class="field">単価（円）<input name="unitPrice" type="number" inputmode="numeric" min="10" step="10" value="${s.unitPrice}" required /></label>
        <label class="field">目標杯数<input name="targetCount" type="number" inputmode="numeric" min="1" value="${s.targetCount}" required /></label>
        <label class="field">営業終了予定<input name="plannedCloseTime" type="time" value="${esc(s.plannedCloseTime)}" /></label>
      </div>
      <h2>キリ番の演出</h2>
      <label class="field">何杯ごとにお祝いするか
        <select name="milestoneEvery" class="select">
          ${(
            [
              [10, "10杯ごと"],
              [25, "25杯ごと"],
              [50, "50杯ごと"],
              [100, "100杯ごと"],
              [0, "お祝いしない"],
            ] as const
          )
            .map(([v, l]) => `<option value="${v}" ${s.milestoneEvery === v ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select></label>
      <p class="sub">キリ番ではクラッカーと音楽でお祝いし、達成の予測時刻を出します。50杯・100杯ごとはさらに派手になります。目標杯数ちょうどは特別な達成演出です。</p>
      <h2>Slack 通知</h2>
      <label class="field">Incoming Webhook URL（この端末の中にだけ保存されます）
        <input name="slackWebhookUrl" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://hooks.slack.com/services/..." value="${esc(s.slackWebhookUrl)}" /></label>
      <div class="row">
        <button type="button" class="btn" data-action="test-slack">テスト送信</button>
        <span class="sub">未送信 ${store.state.pendingNotices}件</span>
        ${store.state.pendingNotices ? `<button type="button" class="btn" data-action="flush-slack">今すぐ再送</button>` : ""}
      </div>
      <h2>効果音</h2>
      <label class="switch"><input name="muted" type="checkbox" ${s.muted ? "checked" : ""} /> ミュート（効果音を鳴らさない）</label>
      <p class="form-error" id="settings-error" role="alert"></p>
      <button type="submit" class="btn primary xl">設定を保存</button>
    </form>

    <section class="card">
      <h2>担当者</h2>
      <p class="sub">登録した人の中から、会計画面の「担当」ボタンでレジ担当者を切り替えられます。会計ごとに担当者が記録されます。</p>
      ${
        s.staff.length
          ? `<ul class="staff-list">${s.staff
              .map(
                (n, i) => `<li><span>${esc(n)}${n === s.currentStaff ? ` <b class="tag tag-sale">レジ担当中</b>` : ""}</span>
                  <button type="button" class="btn small danger" data-action="staff-remove" data-i="${i}">削除</button></li>`,
              )
              .join("")}</ul>`
          : `<p class="sub"><b>まだ登録されていません。</b></p>`
      }
      <form id="staff-form" class="row" novalidate>
        <input name="name" class="text-input" autocomplete="off" placeholder="名前（例：山田）" maxlength="20" />
        <button type="submit" class="btn primary">追加</button>
      </form>
    </section>

    <section class="card">
      <h2>練習 / 本番</h2>
      <p class="sub">練習モードのデータは本番と別に保存されます。現在：<b>${s.mode === "practice" ? "練習モード" : "本番モード"}</b></p>
      <div class="row">
        <button class="btn ${s.mode === "live" ? "primary" : ""}" data-action="mode" data-mode="live">本番モード</button>
        <button class="btn ${s.mode === "practice" ? "primary" : ""}" data-action="mode" data-mode="practice">練習モード</button>
      </div>
    </section>

    ${
      closed
        ? `<section class="card"><h2>締めの解除</h2>
            <p class="sub">締め確定後に会計を再開する必要がある時だけ使います。解除した記録は残ります。</p>
            <button class="btn danger" data-action="unlock">締めを解除</button></section>`
        : ""
    }
    ${
      session?.unlockLog?.length
        ? `<section class="card"><h2>締め解除の記録</h2><ul>${session.unlockLog
            .map((l) => `<li>${hm(new Date(l.at))} ${esc(l.note)}</li>`)
            .join("")}</ul></section>`
        : ""
    }

    <section class="card">
      <h2>データ</h2>
      <div class="row">
        <button class="btn" data-action="csv" ${session ? "" : "disabled"}>CSV出力（バックアップ）</button>
        <button class="btn" data-action="reset-practice">練習データを消す</button>
        <button class="btn danger" data-action="reset-live">本番データを全削除</button>
      </div>
      <p class="sub" id="storage-info"></p>
    </section>
  </main>`;
}
