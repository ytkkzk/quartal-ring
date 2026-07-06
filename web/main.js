// Quartal Loom — Web 表示アダプタ。
// 理論は一切持たず、wasm(core) が返すデータを 4度圏 SVG に描くだけ(ヘキサゴナル)。

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// builtin_scale の id 順(wasm と共有する契約, requirements §5.1)
const SCALE_NAMES = ["Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian"];

const FOURTH = 5; // 完全4度 = 5 半音(時計回りの1歩)
const CENTER = 300;
const R_OUTER = 260;
const R_INNER = 120;

let wasm;
const state = { home: 9 /* A */, scaleId: 5 /* Aeolian */ };

async function init() {
  const resp = await fetch("quartal_loom_wasm.wasm");
  const { instance } = await WebAssembly.instantiateStreaming(resp, {});
  wasm = instance.exports;

  const homeSel = document.getElementById("home");
  NOTE_NAMES.forEach((n, i) => homeSel.add(new Option(n, i)));
  homeSel.value = state.home;
  homeSel.addEventListener("change", (e) => { state.home = +e.target.value; render(); });

  const scaleSel = document.getElementById("scale");
  const count = wasm.builtin_scale_count();
  for (let id = 0; id < count; id++) scaleSel.add(new Option(SCALE_NAMES[id] ?? `#${id}`, id));
  scaleSel.value = state.scaleId;
  scaleSel.addEventListener("change", (e) => { state.scaleId = +e.target.value; render(); });

  render();
}

// 角度(度, 12時=上=-90°, 時計回りに増加) → 座標
function polar(angleDeg, r) {
  const a = (angleDeg - 90) * Math.PI / 180;
  return [CENTER + r * Math.cos(a), CENTER + r * Math.sin(a)];
}

// スロット s の環状ウェッジ path(中心角 s*30°, ギャップ付き)
function wedgePath(s) {
  const gap = 2;
  const a0 = s * 30 - 15 + gap;
  const a1 = s * 30 + 15 - gap;
  const [ox0, oy0] = polar(a0, R_OUTER);
  const [ox1, oy1] = polar(a1, R_OUTER);
  const [ix1, iy1] = polar(a1, R_INNER);
  const [ix0, iy0] = polar(a0, R_INNER);
  return `M ${ox0} ${oy0} A ${R_OUTER} ${R_OUTER} 0 0 1 ${ox1} ${oy1}`
       + ` L ${ix1} ${iy1} A ${R_INNER} ${R_INNER} 0 0 0 ${ix0} ${iy0} Z`;
}

function render() {
  const scaleMask = wasm.builtin_scale(state.scaleId);
  const onScale = wasm.scale_pitch_mask(state.home, scaleMask); // bit p = pitch p on-scale

  const svg = document.getElementById("wheel");
  svg.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";

  for (let s = 0; s < 12; s++) {
    // ホームを最上部(スロット0)に固定 → スロット s のキー = home + 5*s (4度圏の時計回り)
    const pitch = (state.home + FOURTH * s) % 12;
    const isOn = (onScale >> pitch) & 1;

    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", wedgePath(s));
    path.setAttribute("class", "sector");
    path.setAttribute("fill", isOn ? "#2c3550" : "#141414");
    path.setAttribute("stroke", "#000");
    path.setAttribute("stroke-width", "1");
    svg.appendChild(path);

    const [lx, ly] = polar(s * 30, (R_OUTER + R_INNER) / 2);
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", lx);
    label.setAttribute("y", ly);
    label.setAttribute("class", "note-label");
    label.setAttribute("font-size", s === 0 ? "34" : "28");
    label.setAttribute("fill", isOn ? "#ffffff" : "#3a3a3a");
    label.textContent = NOTE_NAMES[pitch];
    svg.appendChild(label);
  }

  // ホーム位置(最上部)の目印リング
  const [hx, hy] = polar(0, (R_OUTER + R_INNER) / 2);
  const ring = document.createElementNS(ns, "circle");
  ring.setAttribute("cx", hx);
  ring.setAttribute("cy", hy);
  ring.setAttribute("r", 30);
  ring.setAttribute("class", "home-ring");
  svg.appendChild(ring);
}

init();
