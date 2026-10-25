//! 附件下载（Rei 2026-10-17）：前端把文件内容（原始字节，不经 JSON）交过来，存进系统的「下载」文件夹，返回存下的完整路径。
//! 文件名放在请求头 x-file-name（encodeURIComponent 编码）；去掉路径分隔符等不能用的字符，重名加「 (2)」「 (3)」。
//! 2026-10-25 起：桌面下载先弹系统保存框（dialog 插件，前端调），再用 save_to_path / att_cache_copy 写过去；手机仍用 save_download。
//! 附件本机缓存在 app 缓存目录 attachments/<id>（att_cache_*）。

use std::fs;
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime};

/// %XX 解码（只认 UTF-8；坏的原样保留）。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

/// 能放进文件名的样子。
fn safe_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control())
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim().to_string();
    if trimmed.is_empty() {
        "file".to_string()
    } else {
        trimmed
    }
}

/// 下载文件夹里不重名的路径。
fn unique_path(dir: &PathBuf, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut n = 2;
    loop {
        let p = dir.join(format!("{stem} ({n}){ext}"));
        if !p.exists() {
            return p;
        }
        n += 1;
    }
}

#[tauri::command]
pub fn save_download<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("需要文件内容".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "file".into());
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = unique_path(&dir, &safe_name(&name));
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// 把文件内容写到用户在保存框里选的路径（Rei 2026-10-25：桌面下载弹系统保存框）。路径放在请求头 x-path（encodeURIComponent）。
/// 路径是用户自己在系统保存框里选的，不再改名去重（系统框已经问过要不要覆盖）。
#[tauri::command]
pub fn save_to_path(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("需要文件内容".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| "需要保存路径".to_string())?;
    let path = PathBuf::from(path);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

// ───────────── 附件本机缓存（Rei 2026-10-25：「附件可以下载、删除、缓存、删除缓存。缓存的附件24小时后清除本地缓存。」）─────────────
// 存在 app 缓存目录 attachments/<附件 id>；记录和 24 小时到期由前端（lib/attachment-cache.ts）管，这里只存、取、删、列、拷。

/// 附件 id 只能是 UUID 那样的字符（防路径穿越）。
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn cache_file<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("附件 id 不对".into());
    }
    Ok(cache_dir(app)?.join(id))
}

/// 存一份：内容是原始字节，附件 id 在请求头 x-id。先写临时文件再改名，写一半不会留下坏文件。
#[tauri::command]
pub fn att_cache_put<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("需要文件内容".into());
    };
    let id = request.headers().get("x-id").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let path = cache_file(&app, &id)?;
    let tmp = path.with_extension("part");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// 取：原始字节（前端拿到 ArrayBuffer）；没有就报错（前端当没缓存）。
#[tauri::command]
pub fn att_cache_get<R: Runtime>(app: AppHandle<R>, id: String) -> Result<tauri::ipc::Response, String> {
    let path = cache_file(&app, &id)?;
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(data))
}

/// 删本机副本（没有也算成功）。
#[tauri::command]
pub fn att_cache_delete<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let path = cache_file(&app, &id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 缓存目录里都有哪些附件（清理孤儿文件用；写了一半的 .part 顺手删掉）。
#[tauri::command]
pub fn att_cache_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    let dir = cache_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".part") {
            let _ = fs::remove_file(entry.path());
        } else if valid_id(&name) {
            out.push(name);
        }
    }
    Ok(out)
}

/// 下载缓存着的附件：从缓存目录拷到用户在保存框里选的路径。
#[tauri::command]
pub fn att_cache_copy<R: Runtime>(app: AppHandle<R>, id: String, dest: String) -> Result<String, String> {
    let src = cache_file(&app, &id)?;
    let dest = PathBuf::from(dest);
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}
