//! Quartal Loom — 生の整数 ABI wasm アダプタ。
//!
//! wasm-bindgen を使わず、整数 in/整数 out だけで core を橋渡しする(コアが整数モデルゆえ成立)。
//! JS 側は `WebAssembly.instantiateStreaming` で読み、これらの関数を直接呼ぶ。
//! ビット表現: 12bit マスク。bit p (0..12) = ピッチクラス p、または度数 p。
#![no_std]

use quartal_loom_core::{modes, IntervalMask, PitchClass, Quality, Scale};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

/// 組込スケール(教会旋法)の id→インターバルマスク。id 順は JS と共有する契約(requirements §5.1)。
/// 0:Ionian 1:Dorian 2:Phrygian 3:Lydian 4:Mixolydian 5:Aeolian 6:Locrian
#[no_mangle]
pub extern "C" fn builtin_scale(id: u32) -> u32 {
    let m = match id {
        0 => modes::IONIAN,
        1 => modes::DORIAN,
        2 => modes::PHRYGIAN,
        3 => modes::LYDIAN,
        4 => modes::MIXOLYDIAN,
        5 => modes::AEOLIAN,
        6 => modes::LOCRIAN,
        _ => modes::IONIAN,
    };
    m.bits() as u32
}

/// 組込スケール数。
#[no_mangle]
pub extern "C" fn builtin_scale_count() -> u32 {
    7
}

/// スケール(root + インターバルマスク)を鳴らしたときの、オンスケールなピッチクラス集合。
/// 返り値 bit p = ピッチクラス p がオンスケール。円盤の各キー扇形の点灯判定に使う。
#[no_mangle]
pub extern "C" fn scale_pitch_mask(root: u32, interval_mask: u32) -> u32 {
    let scale = Scale::new(
        PitchClass::new(root as i32),
        IntervalMask::from_bits(interval_mask as u16),
    );
    let mut out: u32 = 0;
    let mut p = 0u32;
    while p < 12 {
        if scale.contains(PitchClass::new(p as i32)) {
            out |= 1 << p;
        }
        p += 1;
    }
    out
}

/// root と質(0=Major,1=Minor)から、テンション7音のピッチクラス集合(12bit)。
/// 明暗判定は JS 側が `scale_pitch_mask` と AND を取れば求まる。
#[no_mangle]
pub extern "C" fn tension_pitch_mask(root: u32, quality: u32) -> u32 {
    let q = if quality == 1 { Quality::Minor } else { Quality::Major };
    let tones = quartal_loom_core::tensions(PitchClass::new(root as i32), q);
    let mut out: u32 = 0;
    for t in tones {
        out |= 1 << t.pitch.value();
    }
    out
}
