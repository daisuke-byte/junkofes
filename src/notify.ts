import type { Notice, NoticeType } from "./types";
import { newId } from "./domain/time";

export interface NoticeRepo {
  addNotice(n: Notice): Promise<boolean>;
  putNotice(n: Notice): Promise<void>;
  notices(): Promise<Notice[]>;
}

export type Transport = (url: string, text: string) => Promise<void>;

/**
 * Slack Incoming Webhook へ送る。CORS 制限のため
 * application/x-www-form-urlencoded の payload= 形式・mode: 'no-cors' で投げる。
 * レスポンスは読めないので「例外が出なかった」ことを成功とみなす。
 */
export const slackTransport: Transport = async (url, text) => {
  await fetch(url, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "payload=" + encodeURIComponent(JSON.stringify({ text })),
  });
};

export function isWebhookUrl(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\/\S+$/.test(url.trim());
}

export class Notifier {
  private flushing: Promise<number> | null = null;

  constructor(
    private repo: NoticeRepo,
    private transport: Transport,
    private getUrl: () => string,
    private isOnline: () => boolean = () => navigator.onLine,
  ) {}

  /** キューに積んですぐ送信を試みる。重複（同じ id）なら何もしない */
  async enqueue(type: NoticeType, text: string, opts: { id?: string; sessionId?: string; slot?: string } = {}): Promise<boolean> {
    const n: Notice = {
      id: opts.id ?? `${type}:${newId()}`,
      sessionId: opts.sessionId,
      type,
      slot: opts.slot,
      text,
      status: "pending",
      tries: 0,
      createdAt: new Date().toISOString(),
    };
    const added = await this.repo.addNotice(n);
    if (added) void this.flush();
    return added;
  }

  /** 未送信分を古い順に送る。同時に呼ばれても二重送信しない。送れた件数を返す */
  flush(): Promise<number> {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async doFlush(): Promise<number> {
    const url = this.getUrl().trim();
    if (!url || !this.isOnline()) return 0;
    let sent = 0;
    for (const n of await this.repo.notices()) {
      if (n.status !== "pending") continue;
      if (!this.isOnline()) break;
      try {
        await this.transport(url, n.text);
        await this.repo.putNotice({ ...n, status: "sent", tries: n.tries + 1, sentAt: new Date().toISOString() });
        sent++;
      } catch {
        await this.repo.putNotice({ ...n, tries: n.tries + 1 });
        break; // 通信が不安定なら次のタイマー / online イベントで再送
      }
    }
    return sent;
  }

  /** テスト送信（キューに入れず即送る） */
  async sendNow(url: string, text: string): Promise<"ok" | "offline" | "error"> {
    if (!this.isOnline()) return "offline";
    try {
      await this.transport(url.trim(), text);
      return "ok";
    } catch {
      return "error";
    }
  }

  async pendingCount(): Promise<number> {
    return (await this.repo.notices()).filter((n) => n.status === "pending").length;
  }
}
