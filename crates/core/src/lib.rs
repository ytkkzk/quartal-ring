//! Quartal Loom — pure music-theory core.
//!
//! 設計原則(CLAUDE.md): このクレートは純関数の島。I/O・描画・浮動小数点・動的確保を持たない。
//! 音は 12 を法とした整数(ピッチクラス)、スケールは 12bit マスク、転調は加算 mod 12。
//! この整数モデルにより「平行移動性」を構造で保証し、将来の VST / 組込(no_std)移植を壊さない。
#![no_std]

/// 半音の総数(1 オクターブ)。全演算はこれを法とする。
pub const OCTAVE: u8 = 12;

/// ピッチクラス: オクターブを無視した音名(0=C, 1=C#, … 11=B)。常に 0..=11 に正規化される。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PitchClass(u8);

impl PitchClass {
    /// 任意の整数から生成。負値・12 以上も mod 12 で畳み込む(ユークリッド剰余で常に 0..=11)。
    pub const fn new(n: i32) -> Self {
        let m = n.rem_euclid(OCTAVE as i32) as u8;
        PitchClass(m)
    }

    /// 生の値(0..=11)。
    pub const fn value(self) -> u8 {
        self.0
    }

    /// 半音単位で移調。転調・堆積の基礎演算。
    pub const fn transpose(self, semitones: i32) -> Self {
        PitchClass::new(self.0 as i32 + semitones)
    }

    /// self から other までの上行距離(半音, 0..=11)。
    pub const fn interval_to(self, other: PitchClass) -> u8 {
        (other.0 + OCTAVE - self.0) % OCTAVE
    }
}

/// 音程集合を表す 12bit マスク。bit i (0..12) が立つ = ルートから i 半音上の音を含む。
/// ルートに依存しない「形」だけを持つので、転調してもマスクは不変(平行移動性の核)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IntervalMask(u16);

impl IntervalMask {
    /// 半音インターバルの配列(例 [0,2,4,5,7,9,11])からマスクを組む。範囲外(>=12)は無視。
    pub const fn from_intervals(intervals: &[u8]) -> Self {
        let mut bits: u16 = 0;
        let mut i = 0;
        while i < intervals.len() {
            let iv = intervals[i];
            if iv < OCTAVE {
                bits |= 1 << iv;
            }
            i += 1;
        }
        IntervalMask(bits)
    }

    /// 生ビット。
    pub const fn bits(self) -> u16 {
        self.0
    }

    /// ルートから semitones 半音上の音を含むか。
    pub const fn contains_interval(self, semitones: u8) -> bool {
        let s = semitones % OCTAVE;
        (self.0 >> s) & 1 == 1
    }

    /// 含む音の数(スケールの音数)。
    pub const fn len(self) -> u32 {
        self.0.count_ones()
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }
}

/// 具体的なキーに固定されたスケール(ルート音 + 形)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scale {
    pub root: PitchClass,
    pub mask: IntervalMask,
}

impl Scale {
    pub const fn new(root: PitchClass, mask: IntervalMask) -> Self {
        Scale { root, mask }
    }

    /// この音がスケール内(オンスケール)か。false ならスケールアウト。
    /// これが 4度圏表示の「どこまで光るか」の判定そのもの。
    pub const fn contains(&self, pc: PitchClass) -> bool {
        let degree = self.root.interval_to(pc);
        self.mask.contains_interval(degree)
    }

    /// 転調: ルートだけ動かし形(mask)は保つ。平行移動性を構造で保証。
    pub const fn transpose(&self, semitones: i32) -> Self {
        Scale {
            root: self.root.transpose(semitones),
            mask: self.mask,
        }
    }

    /// 構成音を低い度数順に走査するイテレータ。
    pub fn pitches(&self) -> ScalePitches {
        ScalePitches { scale: *self, next: 0 }
    }
}

/// [`Scale::pitches`] のイテレータ。ルートからの度数昇順にピッチクラスを返す。
#[derive(Debug, Clone)]
pub struct ScalePitches {
    scale: Scale,
    next: u8,
}

impl Iterator for ScalePitches {
    type Item = PitchClass;
    fn next(&mut self) -> Option<PitchClass> {
        while self.next < OCTAVE {
            let iv = self.next;
            self.next += 1;
            if self.scale.mask.contains_interval(iv) {
                return Some(self.scale.root.transpose(iv as i32));
            }
        }
        None
    }
}

/// 教会旋法(ダイアトニック 7 旋法)の形。ルート非依存のマスク定義。
pub mod modes {
    use super::IntervalMask;

    pub const IONIAN: IntervalMask = IntervalMask::from_intervals(&[0, 2, 4, 5, 7, 9, 11]);
    pub const DORIAN: IntervalMask = IntervalMask::from_intervals(&[0, 2, 3, 5, 7, 9, 10]);
    pub const PHRYGIAN: IntervalMask = IntervalMask::from_intervals(&[0, 1, 3, 5, 7, 8, 10]);
    pub const LYDIAN: IntervalMask = IntervalMask::from_intervals(&[0, 2, 4, 6, 7, 9, 11]);
    pub const MIXOLYDIAN: IntervalMask = IntervalMask::from_intervals(&[0, 2, 4, 5, 7, 9, 10]);
    pub const AEOLIAN: IntervalMask = IntervalMask::from_intervals(&[0, 2, 3, 5, 7, 8, 10]);
    pub const LOCRIAN: IntervalMask = IntervalMask::from_intervals(&[0, 1, 3, 5, 6, 8, 10]);
}

/// 完全5度 = 7 半音。テンション堆積の基礎音程。
pub const PERFECT_FIFTH: u8 = 7;

/// start から完全5度を積み上げるイテレータ(start 自身を含む)。
pub fn stack_fifths(start: PitchClass, count: usize) -> FifthStack {
    FifthStack { current: start, remaining: count }
}

/// [`stack_fifths`] のイテレータ。
#[derive(Debug, Clone)]
pub struct FifthStack {
    current: PitchClass,
    remaining: usize,
}

impl Iterator for FifthStack {
    type Item = PitchClass;
    fn next(&mut self) -> Option<PitchClass> {
        if self.remaining == 0 {
            return None;
        }
        let out = self.current;
        self.current = self.current.transpose(PERFECT_FIFTH as i32);
        self.remaining -= 1;
        Some(out)
    }
}

/// テンション堆積: コードの質(メジャー/マイナー)。3度から上が質を決める。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    Major,
    Minor,
}

/// テンション音の出所。共通 root 堆積か、質を決める 3度堆積か。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TensionSource {
    /// major/minor 共通の root からの5度堆積(R, P5, 9, 13)。
    CommonRoot,
    /// 質を決める 3度からの5度堆積(M3系 or m3系)。
    QualityThird,
}

/// 1 つのテンション音。表示アダプタはこれを描画・明暗判定に使う。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TensionTone {
    pub pitch: PitchClass,
    /// ルートからの半音距離(0..=11)。
    pub interval: u8,
    /// 度数ラベル(表示用)。例 "R", "M3", "#11", "13"。
    pub label: &'static str,
    pub source: TensionSource,
}

impl TensionTone {
    /// 指定スケールでオンスケールか(明るさ判定用)。
    pub const fn on_scale(&self, scale: &Scale) -> bool {
        scale.contains(self.pitch)
    }
}

// テンション表は 5度堆積から導かれる(tension_tests で堆積との一致を検証)。
// 表示順は tertian(R,3,5,7,9,11,13)。共通=CommonRoot / 質=QualityThird。
use TensionSource::{CommonRoot as CR, QualityThird as QT};

const MAJOR_TABLE: [(u8, &str, TensionSource); 7] = [
    (0, "R", CR),
    (4, "M3", QT),
    (7, "P5", CR),
    (11, "M7", QT),
    (2, "9", CR),
    (6, "#11", QT),
    (9, "13", CR),
];

const MINOR_TABLE: [(u8, &str, TensionSource); 7] = [
    (0, "R", CR),
    (3, "m3", QT),
    (7, "P5", CR),
    (10, "m7", QT),
    (2, "9", CR),
    (5, "11", QT),
    (9, "13", CR),
];

/// root と質から 7 音のテンション集合を導く。tertian 順(R,3,5,7,9,11,13)。
pub fn tensions(root: PitchClass, quality: Quality) -> [TensionTone; 7] {
    let table = match quality {
        Quality::Major => &MAJOR_TABLE,
        Quality::Minor => &MINOR_TABLE,
    };
    let mut out = [TensionTone {
        pitch: root,
        interval: 0,
        label: "R",
        source: CR,
    }; 7];
    let mut i = 0;
    while i < 7 {
        let (iv, label, source) = table[i];
        out[i] = TensionTone {
            pitch: root.transpose(iv as i32),
            interval: iv,
            label,
            source,
        };
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9, A#=10, B=11
    const C: PitchClass = PitchClass::new(0);
    const A: PitchClass = PitchClass::new(9);

    #[test]
    fn pitch_class_wraps_mod_12() {
        assert_eq!(PitchClass::new(12).value(), 0);
        assert_eq!(PitchClass::new(13).value(), 1);
        assert_eq!(PitchClass::new(-1).value(), 11); // 負値もユークリッド剰余で正規化
        assert_eq!(PitchClass::new(-13).value(), 11);
    }

    #[test]
    fn transpose_wraps() {
        assert_eq!(C.transpose(2), PitchClass::new(2)); // C->D
        assert_eq!(C.transpose(-1), PitchClass::new(11)); // C->B
        assert_eq!(A.transpose(3), C); // A->C (9+3=12->0)
    }

    #[test]
    fn interval_to_is_upward_distance() {
        assert_eq!(C.interval_to(PitchClass::new(7)), 7); // C->G
        assert_eq!(PitchClass::new(7).interval_to(C), 5); // G->C は上行 5
        assert_eq!(C.interval_to(C), 0);
    }

    #[test]
    fn mask_membership_and_count() {
        let m = modes::IONIAN;
        assert_eq!(m.len(), 7);
        assert!(m.contains_interval(0));
        assert!(m.contains_interval(4)); // 長3度
        assert!(!m.contains_interval(1)); // ♭9 は無い
    }

    #[test]
    fn c_ionian_on_scale() {
        let c_major = Scale::new(C, modes::IONIAN);
        // 白鍵 C D E F G A B はオンスケール
        for pc in [0, 2, 4, 5, 7, 9, 11] {
            assert!(c_major.contains(PitchClass::new(pc)), "pc {pc} should be on-scale");
        }
        // 黒鍵はスケールアウト
        for pc in [1, 3, 6, 8, 10] {
            assert!(!c_major.contains(PitchClass::new(pc)), "pc {pc} should be out");
        }
    }

    #[test]
    fn a_aeolian_equals_c_major_notes() {
        // 現行 4度圏表の前提(A エオリアン)。構成音は C メジャーと同じ集合。
        let a_aeolian = Scale::new(A, modes::AEOLIAN);
        let mut notes: [bool; 12] = [false; 12];
        for p in a_aeolian.pitches() {
            notes[p.value() as usize] = true;
        }
        let expected = [true, false, true, false, true, true, false, true, false, true, false, true];
        assert_eq!(notes, expected);
    }

    #[test]
    fn transposition_preserves_shape_parallel_movement() {
        // 平行移動性: 転調してもマスク(形)は不変で、含有関係が丸ごと平行移動する。
        let c_major = Scale::new(C, modes::IONIAN);
        let d_major = c_major.transpose(2);
        assert_eq!(d_major.mask, c_major.mask); // 形は同一
        // C がオンなら、2 半音上げた D では D がオン、という平行移動
        for iv in 0..12i32 {
            let in_c = c_major.contains(C.transpose(iv));
            let in_d = d_major.contains(C.transpose(2 + iv));
            assert_eq!(in_c, in_d, "parallel movement broken at iv {iv}");
        }
    }

    #[test]
    fn pitches_iterates_in_degree_order() {
        let c_major = Scale::new(C, modes::IONIAN);
        let collected: [u8; 7] = {
            let mut arr = [0u8; 7];
            let mut i = 0;
            for p in c_major.pitches() {
                arr[i] = p.value();
                i += 1;
            }
            arr
        };
        assert_eq!(collected, [0, 2, 4, 5, 7, 9, 11]);
    }
}

#[cfg(test)]
mod tension_tests {
    use super::*;

    const A: PitchClass = PitchClass::new(9);

    fn pitch_set(tones: &[TensionTone]) -> u16 {
        let mut bits = 0u16;
        for t in tones {
            bits |= 1 << t.pitch.value();
        }
        bits
    }

    #[test]
    fn major_stack_matches_users_note_list() {
        // 本人提示: メジャー堆積 A = A C# E G# B D# F#
        let tones = tensions(A, Quality::Major);
        // C=0..B=11 で {A,C#,E,G#,B,D#,F#} = {9,1,4,8,11,3,6}
        let expected = (1u16 << 9) | (1 << 1) | (1 << 4) | (1 << 8) | (1 << 11) | (1 << 3) | (1 << 6);
        assert_eq!(pitch_set(&tones), expected);
    }

    #[test]
    fn minor_stack_matches_users_note_list() {
        // 本人提示: マイナー堆積 A = A C E G B D F#
        let tones = tensions(A, Quality::Minor);
        // {A,C,E,G,B,D,F#} = {9,0,4,7,11,2,6}
        let expected = (1u16 << 9) | (1 << 0) | (1 << 4) | (1 << 7) | (1 << 11) | (1 << 2) | (1 << 6);
        assert_eq!(pitch_set(&tones), expected);
    }

    #[test]
    fn major_stack_equals_lydian_minor_equals_dorian() {
        // 5度堆積は avoid を自動回避し、メジャー=リディアン / マイナー=ドリアン を生む。
        let a_lydian = Scale::new(A, modes::LYDIAN);
        let a_dorian = Scale::new(A, modes::DORIAN);
        for t in tensions(A, Quality::Major) {
            assert!(a_lydian.contains(t.pitch), "{} not in A Lydian", t.label);
        }
        for t in tensions(A, Quality::Minor) {
            assert!(a_dorian.contains(t.pitch), "{} not in A Dorian", t.label);
        }
    }

    fn stack_mask(start: PitchClass, count: usize) -> u16 {
        let mut bits = 0u16;
        for p in stack_fifths(start, count) {
            bits |= 1 << p.value();
        }
        bits
    }

    #[test]
    fn derivation_matches_fifth_stacking() {
        // 表(MAJOR/MINOR_TABLE)が本当に「共通root堆積(4音) + 3度堆積(3音)」の5度積みと一致するか。
        let root_stack = stack_mask(A, 4); // R,P5,9,13
        let major_third = stack_mask(A.transpose(4), 3); // M3,M7,#11
        let minor_third = stack_mask(A.transpose(3), 3); // m3,m7,11
        assert_eq!(pitch_set(&tensions(A, Quality::Major)), root_stack | major_third);
        assert_eq!(pitch_set(&tensions(A, Quality::Minor)), root_stack | minor_third);
    }

    #[test]
    fn on_scale_dims_out_of_scale_tensions() {
        // 表示スケール=A エオリアン(A B C D E F G)のままメジャー堆積 →
        // M3(C#)・M7(G#)・#11(D#)・13(F#) がアウト(暗く出る)。オンは R・P5・9 のみ。
        let a_aeolian = Scale::new(A, modes::AEOLIAN);
        for t in tensions(A, Quality::Major) {
            let on = t.on_scale(&a_aeolian);
            match t.label {
                "R" | "P5" | "9" => assert!(on, "{} should be on in A aeolian", t.label),
                "M3" | "M7" | "#11" | "13" => assert!(!on, "{} should be out in A aeolian", t.label),
                other => panic!("unexpected label {other}"),
            }
        }
    }

    #[test]
    fn source_splits_common_and_quality() {
        // 共通4音(R,P5,9,13) は CommonRoot、質を決める3音は QualityThird。
        let tones = tensions(A, Quality::Major);
        let common: [&str; 4] = ["R", "P5", "9", "13"];
        for t in tones {
            let is_common = common.contains(&t.label);
            match t.source {
                TensionSource::CommonRoot => assert!(is_common, "{} misclassified", t.label),
                TensionSource::QualityThird => assert!(!is_common, "{} misclassified", t.label),
            }
        }
    }
}
