//! Mindough 原生外壳（Tauri 2）。
//! - os 插件：前端按平台选皮肤
//! - db：本地 SQLite 命令层（schema / 迁移在前端 core，与 Web 端同一份）
//! - 以后：deep link 登录回调、窗口毛玻璃等。

mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .manage(db::Db::new())
        .invoke_handler(tauri::generate_handler![db::db_exec, db::db_run, db::db_all])
        .run(tauri::generate_context!())
        .expect("启动 Mindough 失败");
}
