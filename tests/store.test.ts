import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Database } from "../src/db";
import { emptyDenoms } from "../src/domain/money";
import { Notifier } from "../src/notify";
import { Store } from "../src/store";

async function setup() {
  const db = await Database.open(indexedDB, "s-" + Math.random());
  const sent: string[] = [];
  const notifier = new Notifier(db, async (_u, t) => void sent.push(t), () => "https://hooks.slack.com/x", () => true);
  const store = new Store(db, notifier);
  await store.load();
  return { db, store, sent };
}

describe("会計の確定と保存", () => {
  it("確定した会計はリロード後も復元される", async () => {
    const { db, store } = await setup();
    await store.openSession({ ...emptyDenoms(), y100: 30 });
    await store.confirmSale(2, 1000);
    const again = new Store(db, new Notifier(db, async () => {}, () => ""));
    await again.load();
    expect(again.phase).toBe("open");
    expect(again.state.sales).toHaveLength(1);
    expect(again.state.sales[0]).toMatchObject({ qty: 2, amount: 800, received: 1000, change: 200 });
  });

  it("保存に失敗したら確定しない", async () => {
    const { db, store } = await setup();
    await store.openSession(emptyDenoms());
    db.putSale = () => Promise.reject(new Error("QuotaExceeded"));
    await expect(store.confirmSale(1, 500)).rejects.toThrow("QuotaExceeded");
    expect(store.state.sales).toHaveLength(0);
  });

  it("預かり不足は確定できない", async () => {
    const { store } = await setup();
    await store.openSession(emptyDenoms());
    await expect(store.confirmSale(2, 500)).rejects.toThrow("300円 不足");
  });

  it("目標達成・節目・売り切れのイベントと通知", async () => {
    const { store, sent } = await setup();
    await store.updateSettings({ targetCount: 10, stockCount: 12 });
    await store.openSession(emptyDenoms());
    const e1 = await store.confirmSale(5, 2000);
    expect(e1.reachedGoal).toBe(false);
    const e2 = await store.confirmSale(5, 2000);
    expect(e2.reachedGoal).toBe(true);
    await store.addNonSale("staff", 2, "");
    await store.tick();
    expect(sent.some((t) => t.includes("10杯達成"))).toBe(true);
    expect(sent.some((t) => t.includes("売り切れ"))).toBe(true);
  });

  it("締め確定でロックされ、会計も取り消しもできない。解除は記録が残る", async () => {
    const { store } = await setup();
    await store.openSession({ ...emptyDenoms(), y100: 10 });
    const ev = await store.confirmSale(1, 500);
    await store.startClosing();
    await expect(store.confirmSale(1, 500)).rejects.toThrow();
    await store.closeSession({ ...emptyDenoms(), y100: 9, y500: 1 }, "", "A", "B");
    expect(store.phase).toBe("closed");
    expect(store.state.session).toMatchObject({ expectedCash: 1400, diff: 0, locked: true });
    await expect(store.voidSale(ev.sale.id, "x")).rejects.toThrow();
    await store.unlockSession("追加販売");
    expect(store.phase).toBe("open");
    expect(store.state.session?.unlockLog?.[0].note).toBe("追加販売");
  });

  it("練習モードのデータは本番と別", async () => {
    const { store } = await setup();
    await store.openSession(emptyDenoms());
    await store.confirmSale(1, "exact");
    await store.updateSettings({ mode: "practice" });
    expect(store.phase).toBe("setup");
    await store.openSession(emptyDenoms());
    await store.confirmSale(3, "exact");
    await store.resetMode("practice");
    await store.updateSettings({ mode: "live" });
    expect(store.state.sales).toHaveLength(1);
  });

  it("1,000件の会計でも集計が速い", async () => {
    const { store } = await setup();
    await store.openSession({ ...emptyDenoms(), y100: 100, y500: 50 });
    for (let i = 0; i < 1000; i++) await store.confirmSale(1, 1000);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) store.drawer();
    expect((performance.now() - t0) / 20).toBeLessThan(20);
  }, 30000);
});
