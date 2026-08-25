#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ตรวจ "ตัวแปรที่ไม่มีอยู่จริง" ก่อน deploy
//
//   node tools/check-undef.mjs
//
// ทำไมต้องมี: esbuild (ตัวที่ vite ใช้) แปลงโค้ดอย่างเดียว ไม่ตรวจว่าชื่อตัวแปร
// ที่เรียกใช้มีอยู่จริงไหม — เขียน isCentral ทั้งที่คอมโพเนนต์นั้นชื่อ isCentralBranch
// build ผ่านฉลุย แต่พอ React เรนเดอร์ถึงบรรทัดนั้นจะโยน ReferenceError
// แล้วทั้งแอปกลายเป็นจอขาว (เกิดจริง 25/08/2569 commit a7edf45)
//
// ใช้ @babel/parser + traverse ที่ติดมากับ vite อยู่แล้ว ไม่ต้องลงอะไรเพิ่ม
// อ่านขอบเขตตัวแปรจริง (scope) ไม่ใช่การเดาด้วย regex
// ══════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const traverseMod = require("@babel/traverse");
const traverse = traverseMod.default || traverseMod;

const FILES = process.argv.slice(2);
const TARGETS = FILES.length ? FILES : ["src/FoodCostApp.jsx"];

// ชื่อที่มาจากเบราว์เซอร์/ภาษา — ไม่ได้ประกาศในไฟล์แต่เรียกใช้ได้จริง
const GLOBALS = new Set([
  // ภาษา
  "Object","Array","String","Number","Boolean","Math","JSON","Date","RegExp","Error","TypeError",
  "Promise","Map","Set","WeakMap","WeakSet","Symbol","BigInt","Proxy","Reflect","Intl",
  "parseInt","parseFloat","isNaN","isFinite","encodeURIComponent","decodeURIComponent",
  "encodeURI","decodeURI","undefined","NaN","Infinity","globalThis","structuredClone","queueMicrotask",
  "Uint8Array","Int8Array","Uint16Array","Uint32Array","Float32Array","Float64Array","ArrayBuffer","DataView",
  "AggregateError","RangeError","SyntaxError","ReferenceError","EvalError","URIError","FinalizationRegistry","WeakRef",
  // เบราว์เซอร์
  "window","document","console","navigator","location","history","screen","localStorage","sessionStorage",
  "fetch","Headers","Request","Response","FormData","URL","URLSearchParams","Blob","File","FileReader",
  "setTimeout","clearTimeout","setInterval","clearInterval","requestAnimationFrame","cancelAnimationFrame",
  "requestIdleCallback","cancelIdleCallback","alert","confirm","prompt","atob","btoa",
  "Image","Audio","Video","Canvas","CanvasRenderingContext2D","XMLHttpRequest","WebSocket","EventSource",
  "Event","CustomEvent","MouseEvent","KeyboardEvent","TouchEvent","AbortController","AbortSignal",
  "IntersectionObserver","ResizeObserver","MutationObserver","PerformanceObserver","performance",
  "TextEncoder","TextDecoder","crypto","Notification","ServiceWorker","caches","matchMedia","getComputedStyle","scrollTo","scrollBy",
  "HTMLElement","Element","Node","NodeList","DOMParser","XMLSerializer","Text","Range","Selection",
  "print","open","close","postMessage","addEventListener","removeEventListener","dispatchEvent",
  // node/bundler
  "process","Buffer","require","module","exports","__dirname","__filename","import","globalThis",
]);

let problems = 0;
for (const file of TARGETS) {
  const code = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator", "dynamicImport", "topLevelAwait"],
      errorRecovery: false,
    });
  } catch (e) {
    console.log(`❌ ${file}: อ่านไฟล์ไม่ผ่าน (syntax) — ${e.message}`);
    problems++;
    continue;
  }

  // เก็บชื่อที่ถูกเรียกใช้แต่ไม่มีการประกาศที่ไหนเลยในไฟล์
  const found = new Map();   // ชื่อ -> [บรรทัด, ...]
  traverse(ast, {
    Program(path) {
      for (const [name, refs] of Object.entries(path.scope.globals || {})) {
        if (GLOBALS.has(name)) continue;
        const lines = (Array.isArray(refs) ? refs : [refs])
          .map((r) => (r && r.loc && r.loc.start ? r.loc.start.line : null))
          .filter(Boolean);
        found.set(name, lines);
      }
    },
  });

  // หาบรรทัดจริงของทุกจุดที่อ้างถึง (path.scope.globals เก็บแค่ node แรก)
  if (found.size) {
    const all = new Map([...found.keys()].map((k) => [k, []]));
    traverse(ast, {
      Identifier(path) {
        const n = path.node.name;
        if (!all.has(n)) return;
        if (!path.isReferencedIdentifier()) return;
        if (path.scope.hasBinding(n, true)) return;
        all.get(n).push(path.node.loc?.start?.line);
      },
    });
    for (const [name, lines] of all) {
      const uniq = [...new Set(lines.filter(Boolean))].sort((a, b) => a - b);
      if (!uniq.length) continue;
      problems++;
      console.log(`❌ ${file}: "${name}" ไม่มีการประกาศที่ไหนเลย — บรรทัด ${uniq.slice(0, 8).join(", ")}${uniq.length > 8 ? ` … อีก ${uniq.length - 8} จุด` : ""}`);
      // ช่วยเดาว่าน่าจะหมายถึงตัวไหน
      const near = [];
      traverse(ast, {
        Identifier(p) {
          const c = p.node.name;
          if (c === name || near.includes(c)) return;
          if (!p.isBindingIdentifier()) return;
          // เอาเฉพาะชื่อที่ยาวพอจะสื่อความหมาย และซ้อนทับกันเกินครึ่ง
          if (c.length < 4 || name.length < 4) return;
          const a = c.toLowerCase(), b = name.toLowerCase();
          const overlap = a.includes(b) || b.includes(a);
          if (!overlap) return;
          if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.5) return;
          near.push(c);
        },
      });
      if (near.length) console.log(`     💡 ตัวที่มีอยู่จริงและชื่อใกล้เคียง: ${near.slice(0, 5).join(" · ")}`);
    }
  }
}

console.log(problems === 0
  ? `✅ ไม่มีตัวแปรที่ไม่มีอยู่จริง (${TARGETS.join(", ")})`
  : `\n⚠️ พบ ${problems} ชื่อ — ถ้าปล่อยไป React จะโยน ReferenceError แล้วแอปเป็นจอขาว`);
process.exit(problems ? 1 : 0);
