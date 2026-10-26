//! Mindough 原生外壳（Tauri 2）。
//! - os 插件：前端按平台选皮肤
//! - db：本地 SQLite 命令层（schema / 迁移在前端 core，与 Web 端同一份）
//! - 登录：opener 用系统浏览器打开 Google 登录，deep-link 接住 mindough://auth?code=… 回调（前端 lib/native-login.ts）
//! - 桌面端 single-instance：已经开着时，deep link 交给原来的窗口
//! - notification：提醒（前端 lib/reminders.ts 排程）
//! - widget：主屏小组件读的 JSON 快照（widget-snapshot.json）；桌面「小窗」是前端开的第二个窗口（label mini），设置窗口也是前端开的（label settings）
//! - menu：桌面菜单栏 File → Import → Dida365、「设置…」（文字由前端按界面语言传来，点了发 mindough:menu 给主窗口）
//! - 以后：窗口毛玻璃等。

mod db;
mod files;
mod menu;
mod widget;

#[cfg(desktop)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // single-instance 要最先注册；带 deep-link 特性时，第二个进程带来的链接会转给 onOpenUrl
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
        builder = builder.on_menu_event(|app, event| menu::on_event(app, event.id().as_ref()));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            // 菜单栏先用英文建好（macOS 一开窗就要有编辑菜单，复制粘贴快捷键靠它）；前端定下语言后换成对应文字
            #[cfg(desktop)]
            menu::install(_app.handle(), &menu::MenuLabels::default())?;
            // Windows / Linux 开发时也注册 mindough:// （安装包会自己注册；macOS / 移动端靠 Info.plist / Manifest）
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = _app.deep_link().register_all();
            }
            Ok(())
        })
        .manage(db::Db::new())
        .invoke_handler(tauri::generate_handler![db::db_exec, db::db_run, db::db_all, widget::widget_snapshot, files::save_download, files::save_to_path, files::att_cache_put, files::att_cache_get, files::att_cache_delete, files::att_cache_list, files::att_cache_copy, menu::set_app_menu])
        .run(tauri::generate_context!())
        .expect("启动 Mindough 失败");
}
