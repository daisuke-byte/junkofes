import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * ビルド後のすべてのファイルをキャッシュする Service Worker (dist/sw.js) を生成する。
 * 初回読み込み後は通信なしで起動・会計できる。
 */
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "generate-sw",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    writeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (f !== "sw.js" && !f.endsWith(".map")) files.push(relative(outDir, p).split("\\").join("/"));
        }
      };
      walk(outDir);
      const hash = createHash("sha256");
      for (const f of files.sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest("hex").slice(0, 12);
      const urls = ["./", ...files.map((f) => `./${f}`)];
      const sw = `// 自動生成（vite.config.ts）
const CACHE = "nkk-${version}";
const URLS = ${JSON.stringify(urls)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(URLS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("nkk-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(caches.match("./index.html").then((r) => r || caches.match("./")).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
`;
      writeFileSync(join(outDir, "sw.js"), sw);
    },
  };
}

export default defineConfig({
  // GitHub Pages のサブパス（/リポジトリ名/）でも動くよう相対パスにする
  base: "./",
  build: { target: "es2020", assetsInlineLimit: 0 },
  plugins: [serviceWorker()],
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
