import type { Mode, Notice, Sale, Session, Settings } from "./types";

const DB_NAME = "nkk-register";
const DB_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  unitPrice: 400,
  targetCount: 350,
  plannedCloseTime: "16:00",
  slackWebhookUrl: "",
  coinWarn: { y100: 20, y500: 10 },
  muted: false,
  mode: "live",
  staff: [],
  currentStaff: "",
};

type StoreName = "settings" | "sessions" | "sales" | "notices";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export class Database {
  private constructor(private db: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<Database> {
    return new Promise((resolve, reject) => {
      const r = factory.open(name, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("settings");
        const sessions = db.createObjectStore("sessions", { keyPath: "id" });
        sessions.createIndex("mode", "mode");
        const sales = db.createObjectStore("sales", { keyPath: "id" });
        sales.createIndex("sessionId", "sessionId");
        db.createObjectStore("notices", { keyPath: "id" });
      };
      r.onsuccess = () => resolve(new Database(r.result));
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("データベースが他のタブで使用中です"));
    });
  }

  private async put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    await done(tx); // コミット完了まで待つ（保存できてから確定）
  }

  async getSettings(): Promise<Settings> {
    const tx = this.db.transaction("settings", "readonly");
    const s = (await req(tx.objectStore("settings").get("settings"))) as Partial<Settings> | undefined;
    return { ...DEFAULT_SETTINGS, ...s, coinWarn: { ...DEFAULT_SETTINGS.coinWarn, ...s?.coinWarn } };
  }

  putSettings(s: Settings): Promise<void> {
    return this.put("settings", s, "settings");
  }

  async sessions(mode: Mode): Promise<Session[]> {
    const tx = this.db.transaction("sessions", "readonly");
    const list = (await req(tx.objectStore("sessions").index("mode").getAll(mode))) as Session[];
    return list.sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
  }

  putSession(s: Session): Promise<void> {
    return this.put("sessions", s);
  }

  async sales(sessionId: string): Promise<Sale[]> {
    const tx = this.db.transaction("sales", "readonly");
    const list = (await req(tx.objectStore("sales").index("sessionId").getAll(sessionId))) as Sale[];
    // 旧版の「売上外」の記録は使わない
    return list.filter((s) => s.kind === "sale").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  putSale(s: Sale): Promise<void> {
    return this.put("sales", s);
  }

  /** そのモードの営業セッションと会計をすべて削除する */
  async resetMode(mode: Mode): Promise<void> {
    const sessions = await this.sessions(mode);
    const tx = this.db.transaction(["sessions", "sales", "notices"], "readwrite");
    const salesStore = tx.objectStore("sales");
    const ids = new Set(sessions.map((s) => s.id));
    for (const s of sessions) {
      tx.objectStore("sessions").delete(s.id);
      const keys = await req(salesStore.index("sessionId").getAllKeys(s.id));
      for (const k of keys) salesStore.delete(k);
    }
    const notices = (await req(tx.objectStore("notices").getAll())) as Notice[];
    for (const n of notices) if (n.sessionId && ids.has(n.sessionId)) tx.objectStore("notices").delete(n.id);
    await done(tx);
  }

  // --- Slack 送信キュー ---

  /** 同じ id の通知が既にあれば追加しない（重複防止）。追加したら true */
  async addNotice(n: Notice): Promise<boolean> {
    const tx = this.db.transaction("notices", "readwrite");
    const store = tx.objectStore("notices");
    const exists = await req(store.getKey(n.id));
    if (exists !== undefined) {
      await done(tx);
      return false;
    }
    store.add(n);
    await done(tx);
    return true;
  }

  putNotice(n: Notice): Promise<void> {
    return this.put("notices", n);
  }

  async notices(): Promise<Notice[]> {
    const tx = this.db.transaction("notices", "readonly");
    const list = (await req(tx.objectStore("notices").getAll())) as Notice[];
    return list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
}
