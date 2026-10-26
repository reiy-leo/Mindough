//! 桌面菜单栏：File → Import → Dida365（中文界面：文件 → 导入 → 滴答清单）；「设置…」（⌘, / Ctrl+,，Rei 2026-10-26）。
//! - macOS：全局菜单，保留标准的 App / 编辑 / 窗口菜单（复制粘贴、撤销、全选的快捷键靠「编辑」菜单）。
//! - Windows / Linux：只给主窗口加一条「文件」菜单（导入、退出），不加编辑菜单，免得抢 WebView 自己的快捷键；小窗没有菜单。
//! 启动时先用英文建好（macOS 一开窗就要有编辑菜单）；前端定下界面语言后调 set_app_menu 换成对应文字（文字走前端的 tr()）。
//! 点「Dida365」发事件 `mindough:menu`（payload `import-dida365`）给主窗口，前端打开导入窗口。
//! 点「设置…」发 `open-settings` 给主窗口，前端开（或叫到前面）设置窗口（label settings，lib/windows.ts）。
//! macOS 的「设置…」在 App 菜单「关于」下面；Windows / Linux 在「文件」菜单里。

use serde::Deserialize;

pub const MENU_EVENT: &str = "mindough:menu";
pub const IMPORT_DIDA_ID: &str = "import-dida365";
pub const OPEN_SETTINGS_ID: &str = "open-settings";

/// 菜单上的文字（前端按界面语言传过来；没传的用英文）。
#[derive(Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct MenuLabels {
    pub file: String,
    pub import: String,
    pub dida365: String,
    pub settings: String,
    pub edit: String,
    pub window: String,
    pub about: String,
    pub services: String,
    pub hide: String,
    pub hide_others: String,
    pub show_all: String,
    pub quit: String,
    pub close_window: String,
    pub undo: String,
    pub redo: String,
    pub cut: String,
    pub copy: String,
    pub paste: String,
    pub select_all: String,
    pub minimize: String,
    pub zoom: String,
    pub fullscreen: String,
}

impl Default for MenuLabels {
    fn default() -> Self {
        Self {
            file: "File".into(),
            import: "Import".into(),
            dida365: "Dida365".into(),
            settings: "Settings…".into(),
            edit: "Edit".into(),
            window: "Window".into(),
            about: "About Mindough".into(),
            services: "Services".into(),
            hide: "Hide Mindough".into(),
            hide_others: "Hide Others".into(),
            show_all: "Show All".into(),
            quit: "Quit Mindough".into(),
            close_window: "Close Window".into(),
            undo: "Undo".into(),
            redo: "Redo".into(),
            cut: "Cut".into(),
            copy: "Copy".into(),
            paste: "Paste".into(),
            select_all: "Select All".into(),
            minimize: "Minimize".into(),
            zoom: "Zoom".into(),
            fullscreen: "Enter Full Screen".into(),
        }
    }
}

#[cfg(desktop)]
mod desktop {
    use super::*;
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::{AppHandle, Emitter, Manager, Runtime};

    fn build<R: Runtime>(app: &AppHandle<R>, l: &MenuLabels) -> tauri::Result<Menu<R>> {
        let dida = MenuItem::with_id(app, IMPORT_DIDA_ID, &l.dida365, true, None::<&str>)?;
        let import = Submenu::with_items(app, &l.import, true, &[&dida])?;
        let settings = MenuItem::with_id(app, OPEN_SETTINGS_ID, &l.settings, true, Some("CmdOrCtrl+,"))?;

        #[cfg(target_os = "macos")]
        {
            let info = app.package_info();
            let about = tauri::menu::AboutMetadata {
                name: Some(info.name.clone()),
                version: Some(info.version.to_string()),
                ..Default::default()
            };
            let app_menu = Submenu::with_items(
                app,
                info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, Some(&l.about), Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &settings,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, Some(&l.services))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some(&l.hide))?,
                    &PredefinedMenuItem::hide_others(app, Some(&l.hide_others))?,
                    &PredefinedMenuItem::show_all(app, Some(&l.show_all))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some(&l.quit))?,
                ],
            )?;
            let file = Submenu::with_items(
                app,
                &l.file,
                true,
                &[&import, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::close_window(app, Some(&l.close_window))?],
            )?;
            let edit = Submenu::with_items(
                app,
                &l.edit,
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some(&l.undo))?,
                    &PredefinedMenuItem::redo(app, Some(&l.redo))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some(&l.cut))?,
                    &PredefinedMenuItem::copy(app, Some(&l.copy))?,
                    &PredefinedMenuItem::paste(app, Some(&l.paste))?,
                    &PredefinedMenuItem::select_all(app, Some(&l.select_all))?,
                ],
            )?;
            let window = Submenu::with_items(
                app,
                &l.window,
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some(&l.minimize))?,
                    &PredefinedMenuItem::maximize(app, Some(&l.zoom))?,
                    &PredefinedMenuItem::fullscreen(app, Some(&l.fullscreen))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, Some(&l.close_window))?,
                ],
            )?;
            Menu::with_items(app, &[&app_menu, &file, &edit, &window])
        }

        #[cfg(not(target_os = "macos"))]
        {
            let file = Submenu::with_items(
                app,
                &l.file,
                true,
                &[&import, &PredefinedMenuItem::separator(app)?, &settings, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::quit(app, Some(&l.quit))?],
            )?;
            Menu::with_items(app, &[&file])
        }
    }

    /// 建好菜单并装上（macOS 全局；其他只装在主窗口上）。
    pub fn install<R: Runtime>(app: &AppHandle<R>, labels: &MenuLabels) -> tauri::Result<()> {
        let menu = build(app, labels)?;
        #[cfg(target_os = "macos")]
        {
            app.set_menu(menu)?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            if let Some(w) = app.get_webview_window("main") {
                w.set_menu(menu)?;
            }
        }
        Ok(())
    }

    /// 菜单点击：导入滴答清单 → 叫出主窗口并发事件；设置… → 发给主窗口，由前端开设置窗口（主窗口不用叫到前面）。
    pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
        if id == OPEN_SETTINGS_ID {
            let _ = app.emit_to("main", MENU_EVENT, OPEN_SETTINGS_ID);
            return;
        }
        if id == IMPORT_DIDA_ID {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            let _ = app.emit_to("main", MENU_EVENT, IMPORT_DIDA_ID);
        }
    }
}

#[cfg(desktop)]
pub use desktop::{install, on_event};

/// 前端定下界面语言后调用：按传来的文字重建菜单。手机上没有菜单栏，什么都不做。
#[tauri::command]
pub fn set_app_menu<R: tauri::Runtime>(app: tauri::AppHandle<R>, labels: MenuLabels) -> Result<(), String> {
    #[cfg(desktop)]
    {
        install(&app, &labels).map_err(|e| e.to_string())
    }
    #[cfg(mobile)]
    {
        let _ = (app, labels);
        Ok(())
    }
}
