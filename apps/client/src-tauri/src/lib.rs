//! Mindough 原生外壳（Tauri 2）。M0 只负责装载前端；
//! M1 起加 tauri-plugin-sql / Turso 本地库、deep link 登录回调、窗口毛玻璃等。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 前端用 @tauri-apps/plugin-os 的 platform() 选皮肤
        .plugin(tauri_plugin_os::init())
        .run(tauri::generate_context!())
        .expect("启动 Mindough 失败");
}
