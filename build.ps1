# Quartal Loom — wasm をビルドして web/ へ配置する最小ビルド。
# 使い方: pwsh -File build.ps1   (要 rustup + wasm32-unknown-unknown ターゲット)
$ErrorActionPreference = "Stop"
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

cargo build --release --target wasm32-unknown-unknown -p quartal-loom-wasm
$src = "target/wasm32-unknown-unknown/release/quartal_loom_wasm.wasm"
Copy-Item $src "web/quartal_loom_wasm.wasm" -Force
Write-Host "copied -> web/quartal_loom_wasm.wasm ($((Get-Item $src).Length) bytes)"
