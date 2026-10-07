// 効果音・触覚 (F20) と達成演出 (F15)

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}

/**
 * iOS は「タップ」の操作の中で AudioContext を動かさないと音が出ない。
 * 指で触れた瞬間（pointerdown / touchstart）はタップとみなされないため、
 * 指を離した時（touchend / pointerup / click）に呼ぶ。
 * 画面ロックや別アプリから戻ると止まる（interrupted）ことがあるので毎回確かめる。
 */
export function unlockAudio() {
  try {
    // iPad の消音スイッチがオンでも鳴らす（Safari 17 以降）
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession && nav.audioSession.type !== "playback") nav.audioSession.type = "playback";
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      // 全体の音量をそろえて大きく鳴らす（音割れ防止のコンプレッサー付き）
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = 1.4;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state !== "running") {
      void ctx.resume().catch(() => {});
      // 無音を一瞬鳴らして、iOS の音声出力を確実に有効にする
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch {
    ctx = null;
  }
}

/** 音が出せる状態か（設定画面の表示用） */
export function audioState(): "running" | "stopped" | "unsupported" {
  if (!ctx) return window.AudioContext || "webkitAudioContext" in window ? "stopped" : "unsupported";
  return ctx.state === "running" ? "running" : "stopped";
}

let master: GainNode | null = null;
const out = () => master ?? ctx!.destination;
const ready = () => {
  if (muted || !ctx) return false;
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return true;
};

function tone(freq: number, start: number, dur: number, vol = 0.2, type: OscillatorType = "triangle") {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out());
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** 金管っぽい音（少しずらしたノコギリ波 2つ＋フィルター） */
function brass(freq: number, start: number, dur: number, vol = 0.16) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 2;
  f.frequency.setValueAtTime(600, t0);
  f.frequency.linearRampToValueAtTime(3200, t0 + 0.06);
  f.frequency.exponentialRampToValueAtTime(1400, t0 + Math.max(0.1, dur));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.03);
  g.gain.setValueAtTime(vol * 0.8, t0 + Math.max(0.04, dur - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.25);
  f.connect(g).connect(out());
  for (const detune of [-8, 8]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(f);
    o.start(t0);
    o.stop(t0 + dur + 0.3);
  }
}

let noiseBuf: AudioBuffer | null = null;
function noise(start: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1) {
  if (!ctx) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + start;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(out());
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function kick(start: number, vol = 0.9) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(150, t0);
  o.frequency.exponentialRampToValueAtTime(45, t0 + 0.25);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
  o.connect(g).connect(out());
  o.start(t0);
  o.stop(t0 + 0.4);
}
const snare = (start: number, vol = 0.35) => noise(start, 0.14, vol, "highpass", 1500);
const crash = (start: number, vol = 0.35) => noise(start, 1.8, vol, "highpass", 6000);

/** スネアのロール（だんだん大きく） */
function roll(start: number, dur: number, from = 0.06, to = 0.3) {
  const n = Math.floor(dur / 0.045);
  for (let i = 0; i < n; i++) snare(start + i * 0.045, from + ((to - from) * i) / n);
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "C5" "Bb4" "F#4" を周波数に */
function hz(name: string): number {
  const m = /^([A-G])([b#]?)(\d)$/.exec(name)!;
  const semi = NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (semi - 69) / 12);
}
const chord = (names: string[], start: number, dur: number, vol = 0.09) => names.forEach((n) => brass(hz(n), start, dur, vol));

export function playConfirm() {
  navigator.vibrate?.(30);
  if (!ready()) return;
  tone(1046, 0, 0.09, 0.18);
  tone(1568, 0.07, 0.14, 0.15);
}

export function playError() {
  navigator.vibrate?.([40, 60, 40]);
  if (!ready()) return;
  tone(220, 0, 0.18, 0.2, "square");
}

/** クラッカーの「パーン！」（左右から2発） */
export function playCracker() {
  navigator.vibrate?.([60, 40, 80]);
  if (!ready()) return;
  for (const t of [0, 0.09]) {
    noise(t, 0.35, 1.0, "bandpass", 2200, 0.7);
    noise(t, 0.08, 0.9, "highpass", 4000);
    kick(t, 0.6);
  }
}

/** 勝利のファンファーレ。t は開始時刻 */
function victory(t: number, key = 0, big = false) {
  const f = (n: string, shift = 0) => hz(n) * Math.pow(2, (key + shift) / 12);
  const b = (n: string, s: number, d: number, v = 0.16) => brass(f(n), t + s, d, v);
  const c = (ns: string[], s: number, d: number) => ns.forEach((n) => b(n, s, d, 0.08));
  // タタタ・ターン ターン ターン タタ・ターーン
  b("C5", 0, 0.12);
  b("C5", 0.15, 0.12);
  b("C5", 0.3, 0.12);
  b("C5", 0.45, 0.42);
  c(["C4", "E4", "G4"], 0.45, 0.42);
  b("Ab4", 0.9, 0.4);
  c(["Ab3", "C4", "Eb4"], 0.9, 0.4);
  b("Bb4", 1.35, 0.4);
  c(["Bb3", "D4", "F4"], 1.35, 0.4);
  b("C5", 1.8, 0.14);
  b("Bb4", 1.98, 0.12);
  b("C5", 2.13, big ? 1.6 : 1.2, 0.2);
  c(["C4", "E4", "G4", "C5"], 2.13, big ? 1.6 : 1.2);
  for (const s of [0.45, 0.9, 1.35, 1.8]) kick(t + s, 0.7);
  for (const s of [0.68, 1.13, 1.58]) snare(t + s, 0.3);
  kick(t + 2.13);
  crash(t + 2.13, 0.4);
  if (big) {
    // 2周目は全音上げてさらに盛り上げる
    roll(t + 3.0, 0.6, 0.08, 0.35);
    const B = (n: string, s: number, d: number, v = 0.17) => brass(f(n, 2), t + s, d, v);
    const C = (ns: string[], s: number, d: number) => ns.forEach((n) => brass(f(n, 2), t + s, d, 0.08));
    B("C5", 3.6, 0.12);
    B("C5", 3.75, 0.12);
    B("C5", 3.9, 0.12);
    B("C5", 4.05, 0.4);
    C(["C4", "E4", "G4"], 4.05, 0.4);
    B("Ab4", 4.5, 0.4);
    C(["Ab3", "C4", "Eb4"], 4.5, 0.4);
    B("Bb4", 4.95, 0.4);
    C(["Bb3", "D4", "F4"], 4.95, 0.4);
    B("C5", 5.4, 2.2, 0.22);
    B("G5", 5.4, 2.2, 0.12);
    C(["C4", "E4", "G4", "C5"], 5.4, 2.2);
    for (const s of [4.05, 4.5, 4.95]) kick(t + s, 0.7);
    kick(t + 5.4);
    crash(t + 5.4, 0.5);
    crash(t + 6.2, 0.3);
  }
}

/** 区切りの杯数でのお祝いの音楽。tier 1:小 2:中（50杯ごと） 3:大（100杯ごと） */
export function playMilestone(tier: 1 | 2 | 3) {
  if (!ready()) return;
  if (tier === 1) {
    // 短いジングル「パッパパーン！」
    roll(0.15, 0.35, 0.05, 0.25);
    const seq: [string, number, number][] = [
      ["G4", 0.5, 0.1],
      ["C5", 0.62, 0.1],
      ["E5", 0.74, 0.1],
      ["G5", 0.86, 0.7],
    ];
    for (const [n, s, d] of seq) brass(hz(n), s, d, 0.18);
    chord(["C4", "E4", "G4", "C5"], 0.86, 0.7);
    kick(0.86);
    crash(0.86, 0.3);
    return;
  }
  roll(0.15, 0.6, 0.05, 0.32);
  victory(0.8, 0, tier === 3);
}

/** 目標達成の大ファンファーレ */
export function playFanfare() {
  if (!ready()) return;
  roll(0, 1.4, 0.04, 0.4);
  kick(1.45);
  crash(1.45, 0.5);
  victory(1.6, 0, true);
}

// --- 演出 ---

/** 紙吹雪の色：金・シャンパンを中心に、丹青（단청）の朱・緑青・群青を少し */
export const PARTY_COLORS = ["#E9C46A", "#F4E3B1", "#FFFFFF", "#D4A64A", "#E9C46A", "#C8321E", "#2BA58A", "#1D3A8A"];

type Kind = "spark" | "confetti" | "ribbon";
type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number; kind: Kind; phase: number };

export type PartyOptions = {
  durationMs: number;
  /** クラッカーを左右の下から撃つ回数（0 で撃たない） */
  crackers: number;
  /** 打ち上げ花火 */
  fireworks: boolean;
  /** 上から降る紙吹雪の量 */
  rain: number;
};

/** 全画面の紙吹雪・クラッカー・花火。返り値の関数で停止 */
export function runParty(canvas: HTMLCanvasElement, opt: PartyOptions): () => void {
  const c = canvas.getContext("2d")!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  resize();
  const W = () => canvas.width;
  const H = () => canvas.height;
  const ps: P[] = [];
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = () => PARTY_COLORS[Math.floor(Math.random() * PARTY_COLORS.length)];
  const add = (p: Omit<P, "life" | "rot" | "vr" | "phase">) => ps.push({ ...p, life: 0, rot: rnd(0, 6), vr: rnd(-0.25, 0.25), phase: rnd(0, 6) });

  /** 画面の左下・右下の角からクラッカーを撃つ */
  const cracker = () => {
    for (const side of [0, 1]) {
      const x = side ? W() : 0;
      const y = H();
      const base = side ? -Math.PI * 0.68 : -Math.PI * 0.32; // 画面の中央上へ向ける
      for (let i = 0; i < 90; i++) {
        const a = base + rnd(-0.32, 0.32);
        const sp = rnd(14, 30) * dpr;
        const kind: Kind = i % 6 === 0 ? "ribbon" : "confetti";
        add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rnd(160, 260), color: pick(), size: (kind === "ribbon" ? rnd(26, 46) : rnd(7, 13)) * dpr, kind });
      }
      for (let i = 0; i < 30; i++) {
        const a = base + rnd(-0.5, 0.5);
        const sp = rnd(6, 18) * dpr;
        add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rnd(25, 45), color: "#FFE9A8", size: rnd(2, 4) * dpr, kind: "spark" });
      }
    }
  };
  const burst = () => {
    const x = rnd(0.15, 0.85) * W();
    const y = rnd(0.12, 0.5) * H();
    const color = pick();
    const color2 = pick();
    const n = 70;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = rnd(2.5, 6.5) * dpr;
      add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rnd(50, 80), color: i % 3 ? color : color2, size: rnd(2, 3.5) * dpr, kind: "spark" });
    }
  };
  const rain = (n: number) => {
    for (let i = 0; i < n; i++)
      add({ x: rnd(0, W()), y: rnd(-H() * 0.3, 0), vx: rnd(-1, 1) * dpr, vy: rnd(2, 5) * dpr, max: 400, color: pick(), size: rnd(6, 12) * dpr, kind: "confetti" });
  };

  const start = performance.now();
  let lastBurst = 0;
  let shots = 0;
  let raf = 0;
  let stopped = false;
  if (opt.rain) rain(opt.rain);
  const frame = (now: number) => {
    if (stopped) return;
    const el = now - start;
    // クラッカーは最初に1発、その後 0.9 秒おき
    if (shots < opt.crackers && el >= shots * 900) {
      cracker();
      shots++;
    }
    if (opt.fireworks && el < opt.durationMs - 800 && now - lastBurst > 380) {
      burst();
      lastBurst = now;
    }
    if (opt.rain && el < opt.durationMs - 1500 && Math.random() < 0.3) rain(4);
    c.clearRect(0, 0, W(), H());
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === "spark") {
        p.vx *= 0.96;
        p.vy = p.vy * 0.96 + 0.06 * dpr;
        c.globalAlpha = Math.max(0, 1 - p.life / p.max);
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        c.fill();
      } else {
        // 空気抵抗でふわっと落ちる
        p.vx *= 0.95;
        p.vy = Math.min(p.vy * 0.95 + 0.35 * dpr, 4 * dpr);
        p.vx += Math.sin(p.life / 10 + p.phase) * 0.12 * dpr;
        p.rot += p.vr;
        c.globalAlpha = 1;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.color;
        if (p.kind === "ribbon") {
          // くねくねしたテープ
          c.strokeStyle = p.color;
          c.lineWidth = 3 * dpr;
          c.beginPath();
          for (let k = 0; k <= 8; k++) {
            const yy = (k / 8 - 0.5) * p.size;
            const xx = Math.sin(k * 0.9 + p.life / 6 + p.phase) * 5 * dpr;
            if (k === 0) c.moveTo(xx, yy);
            else c.lineTo(xx, yy);
          }
          c.stroke();
        } else {
          c.scale(1, Math.cos(p.life / 8 + p.phase)); // ひらひら回る
          c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        c.restore();
      }
      if (p.life > p.max || p.y > H() + 60) ps.splice(i, 1);
    }
    c.globalAlpha = 1;
    if (el < opt.durationMs || ps.length > 0) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.addEventListener("resize", resize);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}

/** 目標達成の演出（花火＋紙吹雪＋クラッカー） */
export function runFireworks(canvas: HTMLCanvasElement, durationMs = 5000): () => void {
  return runParty(canvas, { durationMs, crackers: 3, fireworks: true, rain: 160 });
}
