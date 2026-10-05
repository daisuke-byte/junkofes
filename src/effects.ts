// 効果音・触覚 (F20) と達成演出 (F15)

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}

/** iOS は最初のタップで AudioContext を有効化する必要がある */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

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
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export function playConfirm() {
  navigator.vibrate?.(30);
  if (muted || !ctx) return;
  tone(1046, 0, 0.09, 0.18);
  tone(1568, 0.07, 0.14, 0.15);
}

export function playError() {
  navigator.vibrate?.([40, 60, 40]);
  if (muted || !ctx) return;
  tone(220, 0, 0.18, 0.2, "square");
}

export function playFanfare() {
  if (muted || !ctx) return;
  const n = [523, 523, 523, 659, 784, 659, 784, 1046];
  const t = [0, 0.14, 0.28, 0.42, 0.62, 0.9, 1.04, 1.3];
  const d = [0.12, 0.12, 0.12, 0.2, 0.26, 0.12, 0.24, 1.2];
  n.forEach((f, i) => {
    tone(f, t[i], d[i], 0.18, "sawtooth");
    tone(f / 2, t[i], d[i], 0.1, "triangle");
  });
  [1046, 1318, 1568].forEach((f) => tone(f, 1.3, 1.4, 0.07, "triangle"));
}

// --- 演出 ---

/** 丹青（단청）を思わせる配色 */
export const DANCHEONG = ["#C8321E", "#0E7C66", "#F2B705", "#1D3A8A", "#E86A2E", "#2BA58A", "#FFFFFF"];

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number; kind: "spark" | "confetti" };

/** 全画面の紙吹雪と花火。返り値の関数で停止 */
export function runFireworks(canvas: HTMLCanvasElement, durationMs = 5000): () => void {
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
  const pick = () => DANCHEONG[Math.floor(Math.random() * DANCHEONG.length)];

  const burst = () => {
    const x = rnd(0.15, 0.85) * W();
    const y = rnd(0.12, 0.5) * H();
    const color = pick();
    const color2 = pick();
    const n = 70;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = rnd(2.5, 6.5) * dpr;
      ps.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rnd(50, 80), color: i % 3 ? color : color2, size: rnd(2, 3.5) * dpr, rot: 0, vr: 0, kind: "spark" });
    }
  };
  const confetti = (n: number) => {
    for (let i = 0; i < n; i++)
      ps.push({ x: rnd(0, W()), y: rnd(-H() * 0.3, 0), vx: rnd(-1, 1) * dpr, vy: rnd(2, 5) * dpr, life: 0, max: 400, color: pick(), size: rnd(6, 12) * dpr, rot: rnd(0, 6), vr: rnd(-0.2, 0.2), kind: "confetti" });
  };

  const start = performance.now();
  let lastBurst = 0;
  let raf = 0;
  let stopped = false;
  confetti(160);
  const frame = (now: number) => {
    if (stopped) return;
    const el = now - start;
    if (el < durationMs - 800 && now - lastBurst > 380) {
      burst();
      lastBurst = now;
    }
    if (el < durationMs - 1500 && Math.random() < 0.3) confetti(4);
    c.clearRect(0, 0, W(), H());
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === "spark") {
        p.vx *= 0.97;
        p.vy = p.vy * 0.97 + 0.06 * dpr;
        c.globalAlpha = Math.max(0, 1 - p.life / p.max);
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        c.fill();
      } else {
        p.rot += p.vr;
        p.vx += Math.sin(p.life / 12) * 0.05;
        c.globalAlpha = 1;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.color;
        c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        c.restore();
      }
      if (p.life > p.max || p.y > H() + 40) ps.splice(i, 1);
    }
    c.globalAlpha = 1;
    if (el < durationMs || ps.length > 0) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.addEventListener("resize", resize);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}
