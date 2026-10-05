import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Database } from "../src/db";
import { Notifier } from "../src/notify";
import { dueHourlySlot } from "../src/domain/stats";
import { at, session } from "./helpers";

describe("Slack 送信キュー", () => {
  it("オフラインで溜まり、オンライン復帰で1回だけ送られる", async () => {
    const db = await Database.open(indexedDB, "q-" + Math.random());
    let online = false;
    const sent: string[] = [];
    const n = new Notifier(db, async (_url, text) => {
      await new Promise((r) => setTimeout(r, 5));
      sent.push(text);
    }, () => "https://hooks.slack.com/services/T/B/X", () => online);

    await n.enqueue("open", "開始");
    await n.enqueue("hourly", "11:00", { id: "x:hourly:11:00", slot: "11:00" });
    expect(await n.enqueue("hourly", "11:00 again", { id: "x:hourly:11:00", slot: "11:00" })).toBe(false);
    await n.flush();
    expect(sent).toEqual([]);
    expect(await n.pendingCount()).toBe(2);

    online = true;
    await Promise.all([n.flush(), n.flush(), n.flush()]);
    await n.flush();
    expect(sent).toEqual(["開始", "11:00"]);
    expect(await n.pendingCount()).toBe(0);
  });

  it("送信に失敗したら残って次回再送される", async () => {
    const db = await Database.open(indexedDB, "q-" + Math.random());
    let fail = true;
    const sent: string[] = [];
    const n = new Notifier(db, async (_u, text) => {
      if (fail) throw new TypeError("network");
      sent.push(text);
    }, () => "https://hooks.slack.com/x", () => true);
    await n.enqueue("goal", "達成");
    await n.flush();
    expect(sent).toEqual([]);
    fail = false;
    await n.flush();
    expect(sent).toEqual(["達成"]);
  });

  it("Webhook URL が未設定なら送らずに溜めておく", async () => {
    const db = await Database.open(indexedDB, "q-" + Math.random());
    let url = "";
    const sent: string[] = [];
    const n = new Notifier(db, async (_u, t) => void sent.push(t), () => url, () => true);
    await n.enqueue("open", "開始");
    await n.flush();
    expect(sent).toEqual([]);
    url = "https://hooks.slack.com/x";
    await n.flush();
    expect(sent).toEqual(["開始"]);
  });
});

describe("毎正時の判定", () => {
  it("営業開始後の正時ごとに時間帯を返す", () => {
    const s = session(); // 10:00 開始
    expect(dueHourlySlot(s, at(30))).toBeNull();
    expect(dueHourlySlot(s, at(60))).toBe("11:00");
    expect(dueHourlySlot(s, at(119))).toBe("11:00");
    expect(dueHourlySlot(s, at(185))).toBe("13:00");
    expect(dueHourlySlot({ ...s, locked: true }, at(185))).toBeNull();
    expect(dueHourlySlot(null, at(185))).toBeNull();
  });
});
