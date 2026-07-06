// Quartal Loom — Web 表示アダプタ。
// 理論は一切持たず、wasm(core) が返すデータを 4度圏 SVG に描くだけ(ヘキサゴナル)。

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// builtin_scale の id 順(wasm と共有する契約, requirements §5.1)
const SCALE_NAMES = ["Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian"];
// ルートからの半音距離 → テンション度数ラベル(tertian)。major/minor 両集合で衝突しない。
const DEGREE_LABEL = { 0: "R", 2: "9", 3: "m3", 4: "M3", 5: "11", 6: "#11", 7: "P5", 9: "13", 10: "m7", 11: "M7" };

// 堆積の tertian 表示順(度数ラベルと root からの半音)。core の TENSION テーブルを表示側にミラー。
// major/minor で 3rd,7th,11th が変わる。集合の正本は wasm(core), これは並び/ラベルの写像。
const DEGREES = {
  0: [["R", 0], ["M3", 4], ["P5", 7], ["M7", 11], ["9", 2], ["#11", 6], ["13", 9]], // Major
  1: [["R", 0], ["m3", 3], ["P5", 7], ["m7", 10], ["9", 2], ["11", 5], ["13", 9]],   // Minor
};

const FOURTH = 5; // 完全4度 = 5 半音(時計回りの1歩)
const CENTER = 300;
const R_OUTER = 282;
const R_INNER = 88;
const R_LETTER = R_OUTER - 22;   // コードルート名の半径
const R_LIST_TOP = R_OUTER - 52; // 堆積リストの最外
const R_LIST_BOT = R_INNER + 14; // 堆積リストの最内

let wasm;
const state = { home: 9 /* A */, scaleId: 5 /* Aeolian */, quality: 0 /* 0=Major 1=Minor */ };

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

  const toggle = document.getElementById("quality");
  toggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    state.quality = +btn.dataset.q;
    [...toggle.children].forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });

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

const NS = "http://www.w3.org/2000/svg";

// TSDロール: 4度圏の時計位置を mod3 で3群に分ける(12/3/6/9=明, 1/4/7/10=中, 2/5/8/11=暗)。
// 値(明/中/暗)=ロール群、彩度=スケール所属(有彩=オンスケール / 無彩=アウト)。
const HUE = 205; // オンスケール時の色相
function levelOf(slot) { return slot % 3; } // 0=light 1=middle 2=dark
function letterColor(slot, on) {
  const L = [84, 64, 46][levelOf(slot)];
  return on ? `hsl(${HUE} 78% ${L}%)` : `hsl(0 0% ${L}%)`;
}
function sectorFill(slot, on) {
  const L = [22, 15, 9][levelOf(slot)];
  return on ? `hsl(${HUE} 42% ${L}%)` : `hsl(0 0% ${L}%)`;
}

function text(parent, x, y, cls, size, fill, content) {
  const t = document.createElementNS(NS, "text");
  t.setAttribute("x", x);
  t.setAttribute("y", y);
  t.setAttribute("class", cls);
  t.setAttribute("font-size", size);
  t.setAttribute("fill", fill);
  t.textContent = content;
  parent.appendChild(t);
  return t;
}

function render() {
  const scaleMask = wasm.builtin_scale(state.scaleId);
  const onScale = wasm.scale_pitch_mask(state.home, scaleMask); // bit p = pitch p on-scale
  const degrees = DEGREES[state.quality];

  const svg = document.getElementById("wheel");
  svg.innerHTML = "";

  for (let s = 0; s < 12; s++) {
    // ホームを最上部(スロット0)に固定 → スロット s のキー = home + 5*s (4度圏の時計回り)
    const root = (state.home + FOURTH * s) % 12;
    const rootOn = (onScale >> root) & 1;

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", wedgePath(s));
    path.setAttribute("class", "sector");
    path.setAttribute("fill", sectorFill(s, rootOn));
    path.setAttribute("stroke", "#000");
    path.setAttribute("stroke-width", "1");
    svg.appendChild(path);

    // コードルート名(正立)。値=TSDロール群、彩度=オンスケール。
    const [lx, ly] = polar(s * 30, R_LETTER);
    text(svg, lx, ly, "note-label", s === 0 ? "26" : "23",
         letterColor(s, rootOn), NOTE_NAMES[root]);

    // このキーを root とした堆積7音を、セクタに沿って放射状に併記。明暗=オンスケール。
    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `rotate(${s * 30} ${CENTER} ${CENTER})`);
    svg.appendChild(g);
    const step = (R_LIST_TOP - R_LIST_BOT) / (degrees.length - 1);
    degrees.forEach(([label, iv], i) => {
      const pitch = (root + iv) % 12;
      const on = (onScale >> pitch) & 1;
      const y = CENTER - (R_LIST_TOP - i * step);
      text(g, CENTER, y, "tension-label", "11",
           on ? "#cfe3ff" : "#3d3d3d", `${label} ${NOTE_NAMES[pitch]}`);
    });
  }
}

init();
