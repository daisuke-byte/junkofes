// データ構造（要件定義書 8章）。金額はすべて円の整数、時刻は ISO 8601 文字列。

export type Mode = "live" | "practice";

export type Settings = {
  unitPrice: number; // 400
  targetCount: number; // 350
  plannedCloseTime: string; // 営業終了予定 "16:00"（空なら未設定）
  slackWebhookUrl: string;
  milestoneEvery: number; // この杯数ごとにキリ番演出（0 で演出なし）
  muted: boolean;
  mode: Mode;
  staff: string[]; // 登録した担当者
  currentStaff: string; // いまのレジ担当者
};

export type Denoms = {
  y10000: number;
  y5000: number;
  y1000: number;
  y500: number;
  y100: number;
  y50: number;
  y10: number;
};

export type UnlockLog = { at: string; note: string };

export type Session = {
  id: string;
  mode: Mode;
  openedAt: string;
  openingFloat: Denoms; // 準備金
  closingStartedAt?: string; // 「営業終了」を押した時刻（会計ボタン停止中）
  closedAt?: string;
  closingCount?: Denoms; // 締めの実残高
  expectedCash?: number; // 理論残高
  diff?: number; // 差額（実残高 − 理論残高）
  diffNote?: string;
  counter?: string; // 数えた人
  checker?: string; // 確認者
  locked: boolean;
  unlockLog?: UnlockLog[]; // 締め解除の記録
};

// sale 以外は旧版の「売上外」の記録。集計には含めない
export type SaleKind = "sale" | "staff" | "sample" | "waste";

export type Sale = {
  id: string;
  sessionId: string;
  createdAt: string;
  kind: SaleKind; // sale 以外は売上外
  qty: number;
  amount: number; // sale 以外は 0
  received: number;
  change: number;
  receivedDenoms: Denoms;
  changeDenoms: Denoms;
  voided: boolean;
  voidedAt?: string;
  voidNote?: string;
  staff?: string; // 会計したレジ担当者
};

export type NoticeType = "open" | "hourly" | "goal" | "close" | "test";

export type Notice = {
  id: string;
  sessionId?: string;
  type: NoticeType;
  slot?: string; // 定期報告の時間帯 "13:00"（重複防止）
  text: string;
  status: "pending" | "sent";
  tries: number;
  createdAt: string;
  sentAt?: string;
};
