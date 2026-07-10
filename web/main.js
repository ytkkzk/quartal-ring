// Quartal Ring — Web 表示アダプタ。
// 理論(音の集合)は wasm(core)、ここは 4度圏 SVG への描画と操作・アニメだけ(ヘキサゴナル)。

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALE_NAMES = ["Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian"];
const SCALE_ORDER = [3, 0, 4, 1, 5, 2, 6]; // 明→暗: Lydian,Ionian,Mixolydian,Dorian,Aeolian,Phrygian,Locrian
// 度数の tertian 並び順(R,3,5,7,9,11,13)。sort 用の rank。
const DEGREE_RANK = { 0: 0, 3: 1, 4: 1, 7: 2, 10: 4, 11: 4, 1: 8, 2: 8, 5: 10, 6: 10, 8: 12, 9: 12 };

const HUE = 0; // マルーン(#600000 ≒ hue 0)
// TSDロール群の明度。5thは堆積の向きが逆なのでバンドも反転(3n時は不変・n+1とn+2を入替)。
function fillHSL(slot, mode) { const b = mode === "p5" ? (3 - slot % 3) % 3 : slot % 3; return { h: 0, s: 0, l: [7, 14, 27][b] }; }
function textHSL(on) { return on ? { h: HUE, s: 82, l: 46 } : { h: 0, s: 0, l: 38 }; } // 有彩=オン/無彩=アウト

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return `hsl(${lerp(c1.h, c2.h, t)} ${lerp(c1.s, c2.s, t)}% ${lerp(c1.l, c2.l, t)}%)`; }
function musicalSlot(pitch, home, mode) { const f = mode === "p5" ? 7 : FOURTH; return (((pitch - home) * f) % 12 + 12) % 12; }
function normAngle(d) { return ((d + 180) % 360 + 360) % 360 - 180; }
function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; } // easeInOutCubic

const FOURTH = 5, CENTER = 300, R_OUTER = 282, R_INNER = 90;
const R_LETTER = R_OUTER - 22, R_LIST_TOP = R_OUTER - 52, R_LIST_BOT = R_INNER + 14;
const NS = "http://www.w3.org/2000/svg";

let wasm;
// state: home, scaleId, rootMode('p4'|'p5')
let cur = { home: 9, scaleId: 5, rootMode: "p5", circleMode: "p4" };
let animating = false;

const ROOT_LABEL = { 0: "R", 7: "P5", 2: "9", 9: "13" };
// 3rd系(3rd/7th/11th)の m3由来/M3由来 ペア。同一スケールでの併記用。
const THIRD_PAIRS = [
  { label: "3", m: 3, M: 4 },
  { label: "7", m: 10, M: 11 },
  { label: "11", m: 5, M: 6 },
];

// 堆積の構成。各行 = { label, entries:[{interval, prefix?}] }(entriesが2件=m/M併記行)。
// - 4th: 純クォータル7音(R + 完全4度×6)。ラベル R,q4,q7,q10,q13,q16,q19。3rd相当なし。
// - 5th: R堆積(R,5,9,13) ＋ 3rd/7th/11thにm3由来/M3由来を常時ペア併記。
function buildStack(rootMode) {
  if (rootMode === "p4") {
    const out = [];
    for (let i = 0; i < 7; i++) {
      out.push({ label: i === 0 ? "R" : "q" + (1 + 3 * i), entries: [{ interval: (i * 5) % 12 }] });
    }
    return out; // 積み順のまま(tertian sort しない)
  }
  const step = 7; // 5th
  const rootIntervals = [0, 1, 2, 3].map((k) => (k * step) % 12);
  const rows = rootIntervals.map((iv) => ({ label: ROOT_LABEL[iv], rank: DEGREE_RANK[iv], entries: [{ interval: iv }] }));
  for (const p of THIRD_PAIRS) {
    rows.push({ label: p.label, rank: DEGREE_RANK[p.m], entries: [{ interval: p.m, prefix: "m" }, { interval: p.M, prefix: "M" }] });
  }
  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

async function init() {
  const resp = await fetch("quartal_ring_wasm.wasm");
  const { instance } = await WebAssembly.instantiateStreaming(resp, {});
  wasm = instance.exports;

  bindToggle("root", "rootMode");
  bindToggle("circle", "circleMode");
  syncToggles();
  renderFrame(1, cur, cur);
}

function bindToggle(id, field) {
  document.getElementById(id).addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled || animating) return;
    setState({ ...cur, [field]: btn.dataset[id] });
  });
}

// トグルの active 状態を cur から同期。
function syncToggles() {
  for (const [id, field] of [["root", "rootMode"], ["circle", "circleMode"]]) {
    const el = document.getElementById(id);
    [...el.children].forEach((b) => b.classList.toggle("active", b.dataset[id] === cur[field]));
  }
}

function polar(angleDeg, r) {
  const a = (angleDeg - 90) * Math.PI / 180;
  return [CENTER + r * Math.cos(a), CENTER + r * Math.sin(a)];
}
function wedgePathAt(c) {
  const a0 = c - 15, a1 = c + 15;
  const [ox0, oy0] = polar(a0, R_OUTER), [ox1, oy1] = polar(a1, R_OUTER);
  const [ix1, iy1] = polar(a1, R_INNER), [ix0, iy0] = polar(a0, R_INNER);
  return `M ${ox0} ${oy0} A ${R_OUTER} ${R_OUTER} 0 0 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${R_INNER} ${R_INNER} 0 0 0 ${ix0} ${iy0} Z`;
}
// 12時に近いほどフォントを大きく(回転でなめらかに変化)。top=26, それ以外=23。
function letterFont(angleDeg) {
  const c = Math.cos(angleDeg * Math.PI / 180);
  const bump = Math.max(0, Math.min(1, (c - 0.85) / 0.15));
  return 23 + 3 * bump;
}
function onMask(st) { return wasm.scale_pitch_mask(st.home, wasm.builtin_scale(st.scaleId)); }

// prev→next を e(0..1)で補間して1フレーム描画。各音の角度は最短弧で補間。
function renderFrame(e, prev, next) {
  const onPrev = onMask(prev), onNext = onMask(next);
  const sameStack = prev.rootMode === next.rootMode;
  const stackNext = buildStack(next.rootMode);
  const stackPrev = buildStack(prev.rootMode);

  const svg = document.getElementById("wheel");
  svg.innerHTML = "";

  for (let pitch = 0; pitch < 12; pitch++) {
    const slotPrev = musicalSlot(pitch, prev.home, prev.circleMode);
    const slotNext = musicalSlot(pitch, next.home, next.circleMode);
    const angle = slotPrev * 30 + normAngle(slotNext * 30 - slotPrev * 30) * e;
    const fill = mix(fillHSL(slotPrev, prev.circleMode), fillHSL(slotNext, next.circleMode), e);
    const letterCol = mix(textHSL((onPrev >> pitch) & 1), textHSL((onNext >> pitch) & 1), e);

    const secG = document.createElementNS(NS, "g");
    secG.setAttribute("class", "sector");
    secG.addEventListener("click", () => { if (!animating && pitch !== cur.home) setState({ ...cur, home: pitch }); });
    svg.appendChild(secG);

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", wedgePathAt(angle));
    path.setAttribute("fill", fill);
    secG.appendChild(path);

    const [lx, ly] = polar(angle, R_LETTER);
    svgText(secG, lx, ly, "note-label", letterFont(angle), letterCol, NOTE_NAMES[pitch]);

    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `rotate(${angle} ${CENTER} ${CENTER})`);
    secG.appendChild(g);

    if (sameStack) {
      drawStack(g, stackNext, pitch, 1, (tp) => mix(textHSL((onPrev >> tp) & 1), textHSL((onNext >> tp) & 1), e));
    } else {
      // 堆積構造が変わる: 旧をフェードアウト・新をフェードインで層を交差
      drawStack(g, stackPrev, pitch, 1 - e, (tp) => mix(textHSL((onPrev >> tp) & 1), textHSL((onPrev >> tp) & 1), 0));
      drawStack(g, stackNext, pitch, e, (tp) => mix(textHSL((onNext >> tp) & 1), textHSL((onNext >> tp) & 1), 0));
    }
  }
  drawScaleList(svg, prev, next, e);
}

function drawStack(g, stack, root, opacity, colorFor) {
  if (opacity <= 0.01) return;
  const L = stack.length;
  const stepR = L > 1 ? (R_LIST_TOP - R_LIST_BOT) / (L - 1) : 0;
  stack.forEach(({ label, entries }, i) => {
    const y = CENTER - (R_LIST_TOP - i * stepR);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", CENTER); t.setAttribute("y", y);
    t.setAttribute("class", "tension-label");
    if (opacity < 1) t.setAttribute("opacity", opacity.toFixed(3));
    const deg = document.createElementNS(NS, "tspan");
    deg.setAttribute("font-size", "8");
    deg.setAttribute("fill", colorFor((root + entries[0].interval) % 12));
    deg.textContent = label;
    t.appendChild(deg);
    entries.forEach(({ interval, prefix }) => {
      const pitch = (root + interval) % 12;
      const nn = document.createElementNS(NS, "tspan");
      nn.setAttribute("font-size", "11");
      nn.setAttribute("fill", colorFor(pitch));
      nn.textContent = " " + (prefix || "") + NOTE_NAMES[pitch];
      t.appendChild(nn);
    });
    g.appendChild(t);
  });
}

function drawScaleList(svg, prev, next, e) {
  const spacing = 25;
  SCALE_ORDER.forEach((id, i) => {
    const y = CENTER + (i - (SCALE_ORDER.length - 1) / 2) * spacing;
    const wasCur = id === prev.scaleId, isCur = id === next.scaleId;
    // 選択の有彩化もイーズ(彩度/明度を補間)
    const c = mix(scaleHSL(wasCur), scaleHSL(isCur), e);
    const size = lerp(wasCur ? 13 : 11, isCur ? 13 : 11, e);
    const t = svgText(svg, CENTER, y, "scale-item", size.toFixed(2), c, SCALE_NAMES[id]);
    if (isCur) t.setAttribute("font-weight", "700");
    t.addEventListener("click", () => { if (!animating && id !== cur.scaleId) setState({ ...cur, scaleId: id }); });
  });
}
function scaleHSL(isCur) { return isCur ? { h: HUE, s: 80, l: 50 } : { h: 0, s: 0, l: 47 }; }

function svgText(parent, x, y, cls, size, fill, content) {
  const t = document.createElementNS(NS, "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  t.setAttribute("class", cls); t.setAttribute("font-size", size);
  t.setAttribute("fill", fill); t.textContent = content;
  parent.appendChild(t);
  return t;
}

// 状態遷移(位置・色・彩度・フォントを一括でイーズ)。
function setState(next) {
  if (animating) return;
  const prev = cur;
  cur = next;
  syncToggles();
  const moved = prev.home !== next.home || prev.circleMode !== next.circleMode;
  const dur = moved ? 460 : 280;
  const t0 = performance.now();
  animating = true;
  function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    renderFrame(ease(p), prev, next);
    if (p < 1) requestAnimationFrame(frame);
    else { animating = false; renderFrame(1, next, next); }
  }
  requestAnimationFrame(frame);
}

init();
