import type { Database } from "./db";
import { computeChange, emptyDenoms, sumDenoms, type ReceiveOption } from "./domain/money";
import { closeText, goalText, hourlyText, openText } from "./domain/messages";
import { crossedMilestone, dueHourlySlot, expectedDrawer, totals } from "./domain/stats";
import { newId } from "./domain/time";
import type { Notifier } from "./notify";
import type { Denoms, Mode, Sale, Session, Settings } from "./types";

export type SaleEvent = {
  sale: Sale;
  before: number; // 会計前の累計杯数
  after: number;
  reachedGoal: boolean;
  milestone: number | null; // お祝いする杯数（30杯から10杯ごとなど）
};

export type State = {
  settings: Settings;
  session: Session | null; // 現在のモードの最新セッション
  sales: Sale[];
  pendingNotices: number;
};

type Listener = () => void;

export class Store {
  state!: State;
  private listeners = new Set<Listener>();

  constructor(
    private db: Database,
    private notifier: Notifier,
  ) {}

  async load(): Promise<void> {
    const settings = await this.db.getSettings();
    const sessions = await this.db.sessions(settings.mode);
    const session = sessions[sessions.length - 1] ?? null;
    const sales = session ? await this.db.sales(session.id) : [];
    this.state = { settings, session, sales, pendingNotices: await this.notifier.pendingCount() };
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  get phase(): "setup" | "open" | "closing" | "closed" {
    const s = this.state.session;
    if (!s) return "setup";
    if (s.locked) return "closed";
    if (s.closingStartedAt) return "closing";
    return "open";
  }

  drawer(): Denoms {
    const s = this.state.session;
    return s ? expectedDrawer(s.openingFloat, this.state.sales) : emptyDenoms();
  }

  private async notify(...args: Parameters<Notifier["enqueue"]>) {
    try {
      await this.notifier.enqueue(...args);
    } catch (e) {
      console.error(e);
    }
    await this.refreshPending();
    // 送信は待たない（会計を止めないため）。終わったら未送信件数を更新
    void this.notifier.flush().then(() => this.refreshPending());
  }

  async refreshPending() {
    this.set({ pendingNotices: await this.notifier.pendingCount() });
  }

  // --- 設定 ---

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const next = { ...this.state.settings, ...patch };
    await this.db.putSettings(next);
    if (patch.mode && patch.mode !== this.state.settings.mode) {
      const list = await this.db.sessions(next.mode);
      const session = list[list.length - 1] ?? null;
      const sales = session ? await this.db.sales(session.id) : [];
      this.set({ settings: next, session, sales });
    } else {
      this.set({ settings: next });
    }
    void this.notifier.flush().then(() => this.refreshPending());
  }

  // --- 営業開始 (F05) ---

  async openSession(float: Denoms): Promise<void> {
    const session: Session = {
      id: newId(),
      mode: this.state.settings.mode,
      openedAt: new Date().toISOString(),
      openingFloat: float,
      locked: false,
    };
    await this.db.putSession(session);
    this.set({ session, sales: [] });
    await this.notify("open", openText(this.state.settings, session), { id: `${session.id}:open`, sessionId: session.id });
  }

  // --- 会計 (F01, F03) ---

  /** 保存に成功した時だけ確定する。失敗したら例外を投げ、状態は変えない */
  async confirmSale(qty: number, option: ReceiveOption): Promise<SaleEvent> {
    const { session, settings, sales } = this.state;
    if (!session || this.phase !== "open") throw new Error("営業中ではありません");
    const r = computeChange(qty, settings.unitPrice, option);
    if (!r.ok) throw new Error(`${r.shortage}円 不足しています`);
    const sale: Sale = {
      id: newId(),
      sessionId: session.id,
      createdAt: new Date().toISOString(),
      kind: "sale",
      qty,
      amount: r.total,
      received: r.received,
      change: r.change,
      receivedDenoms: r.receivedDenoms,
      changeDenoms: r.changeDenoms,
      voided: false,
      staff: settings.currentStaff || undefined,
    };
    const before = totals(sales).soldQty;
    await this.db.putSale(sale);
    const next = [...sales, sale];
    this.set({ sales: next });

    const after = before + qty;
    const target = settings.targetCount;
    const reachedGoal = before < target && after >= target;
    const milestone = reachedGoal ? null : crossedMilestone(before, after, settings.milestoneEvery, target, settings.milestoneStart);
    if (reachedGoal)
      await this.notify("goal", goalText(settings, session, new Date(sale.createdAt)), { id: `${session.id}:goal`, sessionId: session.id });
    return { sale, before, after, reachedGoal, milestone };
  }

  // --- 取り消し (F02) ---

  async voidSale(id: string, note: string): Promise<void> {
    if (this.phase === "closed") throw new Error("締め確定後は取り消せません");
    const target = this.state.sales.find((s) => s.id === id);
    if (!target || target.voided) return;
    const updated: Sale = { ...target, voided: true, voidedAt: new Date().toISOString(), voidNote: note };
    await this.db.putSale(updated);
    this.set({ sales: this.state.sales.map((s) => (s.id === id ? updated : s)) });
  }

  lastActiveSale(): Sale | null {
    for (let i = this.state.sales.length - 1; i >= 0; i--) {
      const s = this.state.sales[i];
      if (!s.voided) return s;
    }
    return null;
  }

  // --- レジ締め (F06) ---

  async startClosing(): Promise<void> {
    const s = this.state.session;
    if (!s || this.phase !== "open") return;
    const next = { ...s, closingStartedAt: new Date().toISOString() };
    await this.db.putSession(next);
    this.set({ session: next });
  }

  async cancelClosing(): Promise<void> {
    const s = this.state.session;
    if (!s || this.phase !== "closing") return;
    const next = { ...s };
    delete next.closingStartedAt;
    await this.db.putSession(next);
    this.set({ session: next });
  }

  async closeSession(count: Denoms, diffNote: string, counter: string, checker: string): Promise<void> {
    const s = this.state.session;
    if (!s || this.phase !== "closing") throw new Error("レジ締めの状態ではありません");
    const expectedCash = sumDenoms(this.drawer());
    const actual = sumDenoms(count);
    const next: Session = {
      ...s,
      closedAt: new Date().toISOString(),
      closingCount: count,
      expectedCash,
      diff: actual - expectedCash,
      diffNote,
      counter,
      checker,
      locked: true,
    };
    await this.db.putSession(next);
    this.set({ session: next });
    await this.notify("close", closeText(this.state.settings, next, this.state.sales), {
      id: `${s.id}:close:${next.closedAt}`,
      sessionId: s.id,
    });
  }

  /** 締めを解除して会計を再開する。解除した事実は記録に残す */
  async unlockSession(note: string): Promise<void> {
    const s = this.state.session;
    if (!s || !s.locked) return;
    const next: Session = { ...s, locked: false, unlockLog: [...(s.unlockLog ?? []), { at: new Date().toISOString(), note }] };
    delete next.closingStartedAt;
    await this.db.putSession(next);
    this.set({ session: next });
  }

  async resetMode(mode: Mode): Promise<void> {
    await this.db.resetMode(mode);
    if (mode === this.state.settings.mode) this.set({ session: null, sales: [] });
    await this.refreshPending();
  }

  // --- 定期処理（1分ごと） ---

  async tick(now = new Date()): Promise<void> {
    const { session, settings, sales } = this.state;
    const slot = dueHourlySlot(session, now);
    if (session && slot) {
      await this.notify("hourly", hourlyText(settings, session, sales, now, slot), {
        id: `${session.id}:hourly:${slot}`,
        sessionId: session.id,
        slot,
      });
    }
    await this.notifier.flush();
    await this.refreshPending();
  }
}
