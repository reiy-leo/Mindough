//! 主屏小组件的数据快照：前端（lib/widget-snapshot.ts）把「我的一天 + 今天要打卡」写成一小段 JSON，
//! 这里存到 app 数据目录的 `widget-snapshot.json`。Android AppWidget / iOS WidgetKit 读它（见 docs/WIDGETS.md）。
//! 只写文件，不做别的；写失败返回错误文字。

use std::fs;
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub fn widget_snapshot<R: Runtime>(app: AppHandle<R>, json: String) -> Result<(), String> {
    // 不是合法 JSON 就不写，免得小组件读到坏数据
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("widget-snapshot.json.tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("widget-snapshot.json")).map_err(|e| e.to_string())?;
    Ok(())
}
