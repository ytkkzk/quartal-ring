// Quartal Loom — Web 表示アダプタ。
// 理論は一切持たず、wasm(core) が返すデータを 4度圏 SVG に描くだけ(ヘキサゴナル)。

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// builtin_scale の id 順(wasm と共有する契約, requirements §5.1)
const SCALE_NAMES = ["Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian"];
// 堆積の tertian 表示順(度数ラベルと root からの半音)。core の TENSION テーブルを表示側にミラー。
const DEGREES = {
  0: [["R", 0], ["M3", 4], ["P5", 7], ["M7", 11], ["9", 2], ["#11", 6], ["13", 9]], // Major
  1: [["R", 0], ["m3", 3], ["P5", 7], ["m7", 10], ["9", 2], ["11", 5], ["13", 9]],   // Minor
};

// 有彩色の色相=マルーン(#600000 ≒ hue 0)。彩度/明度は視認性優先で調整。
const HUE = 0;
function levelOf(slot) { return slot % 3; }
// セクタ背景: TSDロール群の値のみ(彩度なし)。12/3/6/9=最暗 > 1/4/7/10=暗 > 2/5/8/11=中。
function sectorFill(slot) {
  return `hsl(0 0% ${[8, 16, 30][levelOf(slot)]}%)`;
}
// 前景テキスト: スケール所属を彩度で(有彩マルーン=オンスケール / 無彩=アウト)。
function textColor(on) {
  return on ? `hsl(${HUE} 65% 58%)` : `hsl(0 0% 46%)`;
}

const FOURTH = 5; // 完全4度 = 5 半音(時計回りの1歩)
const CENTER = 300;
const R_OUTER = 282;
const R_INNER = 90;
const R_LETTER = R_OUTER - 22;
const R_LIST_TOP = R_OUTER - 52;
const R_LIST_BOT = R_INNER + 14;

let wasm;
const state = { home: 9 /* A */, scaleId: 5 /* Aeolian */, quality: 0 /* 0=Major 1=Minor */ };
let rot = 0;          // 現在の回転オフセット(度・アニメ用)
let animating = false;

const NS = "http://www.w3.org/2000/svg";

async function init() {
  const resp = await fetch("quartal_loom_wasm.wasm");
  const { instance } = await WebAssembly.instantiateStreaming(resp, {});
  wasm = instance.exports;

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

// 中心角(度)の環状ウェッジ path(±15°)
function wedgePathAt(c) {
  const a0 = c - 15, a1 = c + 15;
  const [ox0, oy0] = polar(a0, R_OUTER);
  const [ox1, oy1] = polar(a1, R_OUTER);
  const [ix1, iy1] = polar(a1, R_INNER);
  const [ix0, iy0] = polar(a0, R_INNER);
  return `M ${ox0} ${oy0} A ${R_OUTER} ${R_OUTER} 0 0 1 ${ox1} ${oy1}`
       + ` L ${ix1} ${iy1} A ${R_INNER} ${R_INNER} 0 0 0 ${ix0} ${iy0} Z`;
}

function svgText(parent, x, y, cls, size, fill, content) {
  const t = document.createElementNS(NS, "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  t.setAttribute("class", cls); t.setAttribute("font-size", size);
  t.setAttribute("fill", fill); t.textContent = content;
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
    // ホーム=スロット0(上)。回転アニメ中は rot を加える。
    const root = (state.home + FOURTH * s) % 12;
    const rootOn = (onScale >> root) & 1;
    const center = s * 30 + rot;

    const secG = document.createElementNS(NS, "g");
    secG.setAttribute("class", "sector");
    secG.addEventListener("click", () => spinTo(root));
    svg.appendChild(secG);

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", wedgePathAt(center));
    path.setAttribute("fill", sectorFill(s));
    path.setAttribute("stroke", "none");
    secG.appendChild(path);

    // コードルート名(正立)。彩度=オンスケール。
    const [lx, ly] = polar(center, R_LETTER);
    svgText(secG, lx, ly, "note-label", s === 0 ? "26" : "23", textColor(rootOn), NOTE_NAMES[root]);

    // このキーを root とした堆積7音を、セクタに沿って放射状に併記。
    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `rotate(${center} ${CENTER} ${CENTER})`);
    secG.appendChild(g);
    const step = (R_LIST_TOP - R_LIST_BOT) / (degrees.length - 1);
    degrees.forEach(([label, iv], i) => {
      const pitch = (root + iv) % 12;
      const on = (onScale >> pitch) & 1;
      const y = CENTER - (R_LIST_TOP - i * step);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", CENTER); t.setAttribute("y", y);
      t.setAttribute("class", "tension-label"); t.setAttribute("fill", textColor(on));
      const deg = document.createElementNS(NS, "tspan");
      deg.setAttribute("font-size", "8"); deg.textContent = label;
      const nn = document.createElementNS(NS, "tspan");
      nn.setAttribute("font-size", "11"); nn.textContent = " " + NOTE_NAMES[pitch];
      t.appendChild(deg); t.appendChild(nn);
      g.appendChild(t);
    });
  }

  drawScaleList(svg);
}

// 中央にスケール一覧(クリックで切替。現在のものを有彩で強調)。回転しない。
function drawScaleList(svg) {
  const spacing = 18;
  SCALE_NAMES.forEach((name, id) => {
    const y = CENTER + (id - (SCALE_NAMES.length - 1) / 2) * spacing;
    const cur = id === state.scaleId;
    const t = svgText(svg, CENTER, y, "scale-item", cur ? "15" : "13",
                      cur ? `hsl(${HUE} 62% 60%)` : "#777", name);
    if (cur) t.setAttribute("font-weight", "700");
    t.addEventListener("click", () => { state.scaleId = id; render(); });
  });
}

// クリックしたルートが 12時に来るよう、最短方向へイーズ回転してから home を確定。
function spinTo(pitch) {
  if (animating) return;
  const slot = ((pitch - state.home) * FOURTH % 12 + 12) % 12; // 現レイアウトでのスロット
  if (slot === 0) return;
  let delta = -slot * 30;
  delta = ((delta + 180) % 360 + 360) % 360 - 180; // 最短方向へ正規化
  const dur = 460;
  const t0 = performance.now();
  animating = true;
  function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
    rot = delta * e;
    render();
    if (p < 1) {
      requestAnimationFrame(frame);
    } else {
      state.home = pitch; rot = 0; animating = false; render();
    }
  }
  requestAnimationFrame(frame);
}

init();
