//! 窗口材质：桌面窗口透出桌面壁纸的颜色，像原生 app（Rei 2026-10-26「mindough app的背景，侧边栏背景不像是原生app的bg sensitive的」）。
//!
//! - macOS：整个窗口铺 NSVisualEffectView 的 Sidebar 材质（失焦时跟系统一样变灰），网页背景透明；
//!   侧边栏透出材质，内容区由前端画不透明的底（styles/vibrancy.css）。窗口透明要开 macOSPrivateApi。
//! - Windows 11（build ≥ 22000）：Mica。Windows 10 没有 Mica，窗口不透明，前端照旧画纯色。
//! - Linux、手机：不变。
//!
//! 主窗口：macOS 在 tauri.macos.conf.json 里直接带 transparent + windowEffects；Windows 在
//! tauri.windows.conf.json 里写 `create: false`，这里按系统版本决定透不透明再建（Win10 不能建成透明窗口，开窗那一下会闪出桌面）。
//! 小窗、设置窗口是前端开的：先问 `window_material`，再带上同样的 transparent / windowEffects。
//! 前端拿到材质名后给 html 加 `is-vibrant`，只有 Apple / WinUI 皮肤会把背景改透明（Material 皮肤照旧不透明，盖住材质）。

/// 这台机器上窗口能用的材质：`vibrancy`（macOS）、`mica`（Windows 11）、`none`。
pub fn material() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "vibrancy"
    }
    #[cfg(windows)]
    {
        if windows_build() >= 22000 {
            "mica"
        } else {
            "none"
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        "none"
    }
}

#[cfg(windows)]
fn windows_build() -> u64 {
    match os_info::get().version() {
        os_info::Version::Semantic(_, _, build) => *build,
        _ => 0,
    }
}

/// Windows 主窗口：按 tauri.windows.conf.json 里 label 为 main 的配置（`create: false`）建，Win11 才透明 + Mica。
#[cfg(windows)]
pub fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    use tauri::window::{Effect, EffectsBuilder};
    let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() else {
        return Ok(());
    };
    let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?;
    if material() == "mica" {
        builder = builder.transparent(true).effects(EffectsBuilder::new().effect(Effect::Mica).build());
    } else {
        builder = builder.transparent(false);
    }
    builder.build()?;
    Ok(())
}

/// 前端问材质，顺便把窗口的深浅色设成界面用的那套（`light` / `dark`；空 = 跟着系统）。
/// macOS 的材质、Windows 的 Mica 都按窗口的深浅色画，界面手动选了深色时窗口也要跟着变。
/// 同步命令在主线程跑（改 NSAppearance 要在主线程）。
#[tauri::command]
pub fn window_material<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, theme: Option<String>) -> &'static str {
    // 没有材质的系统（Linux、Win10）不动窗口主题，保持原样
    #[cfg(desktop)]
    if material() != "none" {
        let t = match theme.as_deref() {
            Some("dark") => Some(tauri::Theme::Dark),
            Some("light") => Some(tauri::Theme::Light),
            _ => None,
        };
        let _ = window.set_theme(t);
    }
    #[cfg(any(mobile, not(any(target_os = "macos", windows))))]
    let _ = (&window, &theme);
    material()
}
