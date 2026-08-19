//! 原生菜单：构建（按语言）、事件处理、语言切换命令。

use tauri::menu::{CheckMenuItem, Menu, MenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};

use crate::{cache, AppState};

/// 菜单项的中/英文案（locale = "en" 取英文，否则中文）。
fn menu_label(key: &str, locale: &str) -> &'static str {
    let en = locale == "en";
    match key {
        "dirs" => if en { "Folders" } else { "目录" },
        "open_data" => if en { "Open Data Folder" } else { "打开数据目录" },
        "open_cache" => if en { "Open Cache Folder" } else { "打开缓存目录" },
        "open_logs" => if en { "Open Logs Folder" } else { "打开日志目录" },
        "open_devtools" => if en { "Open DevTools" } else { "打开调试控制台" },
        "language" => if en { "Language" } else { "语言" },
        "check_update" => if en { "Check for Updates…" } else { "检查更新…" },
        "settings" => if en { "Settings…" } else { "设置…" },
        _ => "",
    }
}

/// 主窗口标题跟随语言。窗口建的时候是 hidden_title，标题不画在窗口上，
/// 但「窗口」菜单、Mission Control、Dock 右键菜单仍然显示它——
/// 切到英文后留一个中文标题在那里很突兀。查看器窗口标题恒为空，不参与。
pub fn sync_window_title<R: tauri::Runtime>(app: &AppHandle<R>, locale: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_title(if locale == "en" {
            "Photo Browser"
        } else {
            "照片浏览器"
        });
    }
}

/// 按当前语言构建原生菜单（默认菜单 + “目录”子菜单 + 仅 dev 的调试入口）。
pub fn build_menu<R: tauri::Runtime>(app: &AppHandle<R>, locale: &str) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    let l = |k: &str| menu_label(k, locale);

    // 「检查更新…」「设置…」按 macOS 惯例放应用菜单 About 之下（默认菜单首个子菜单即应用菜单）
    let check_update =
        MenuItem::with_id(app, "check_update", l("check_update"), true, None::<&str>)?;
    let settings =
        MenuItem::with_id(app, "open_settings", l("settings"), true, Some("CmdOrCtrl+,"))?;
    if let Some(tauri::menu::MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        app_menu.insert(&check_update, 1)?;
        app_menu.insert(&settings, 2)?;
    }

    let open_data = MenuItem::with_id(app, "open_data", l("open_data"), true, None::<&str>)?;
    let open_cache = MenuItem::with_id(app, "open_cache", l("open_cache"), true, None::<&str>)?;
    let open_logs = MenuItem::with_id(app, "open_logs", l("open_logs"), true, None::<&str>)?;
    let dirs = Submenu::with_items(app, l("dirs"), true, &[&open_data, &open_cache, &open_logs])?;
    menu.append(&dirs)?;

    // 语言子菜单：母语名固定（中文 / English），勾选当前语言
    let lang_zh = CheckMenuItem::with_id(app, "lang_zh", "中文", true, locale != "en", None::<&str>)?;
    let lang_en =
        CheckMenuItem::with_id(app, "lang_en", "English", true, locale == "en", None::<&str>)?;
    let lang_menu = Submenu::with_items(app, l("language"), true, &[&lang_zh, &lang_en])?;
    menu.append(&lang_menu)?;

    #[cfg(debug_assertions)]
    {
        let devtools =
            MenuItem::with_id(app, "open_devtools", l("open_devtools"), true, None::<&str>)?;
        menu.append(&devtools)?;
    }
    Ok(menu)
}

/// 菜单事件处理（注册在 setup 的 on_menu_event）。
pub fn handle_menu_event(app: &AppHandle, event: &tauri::menu::MenuEvent) {
    #[cfg(debug_assertions)]
    if event.id().as_ref() == "open_devtools" {
        if let Some(w) = app.get_webview_window("main") {
            w.open_devtools();
        }
        return;
    }
    // 语言切换：重建菜单（更新勾选）+ 通知前端切换语言
    let id = event.id().as_ref();
    // 「检查更新…」与「设置…」的 UI（UpdateBanner / SettingsDialog）都只挂在主窗口，
    // 但菜单是应用级的：查看器窗口聚焦时也能触发（主窗口运行中再「打开方式」会两窗并存）。
    // 所以定向发给 main 并把它带到前台，否则横幅/弹窗在背后打开，用户完全看不见。
    if id == "check_update" || id == "open_settings" {
        let Some(w) = app.get_webview_window("main") else {
            return; // 纯查看器模式（双击文件冷启动）没有主窗口，静默忽略
        };
        let _ = w.unminimize();
        let _ = w.set_focus();
        let event = if id == "check_update" {
            "check-update-requested"
        } else {
            "open-settings"
        };
        let _ = app.emit_to("main", event, ());
        return;
    }
    if id == "lang_zh" || id == "lang_en" {
        let lang = if id == "lang_en" { "en" } else { "zh" };
        *app.state::<AppState>()
            .locale
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = lang.to_string();
        if let Ok(menu) = build_menu(app, lang) {
            let _ = app.set_menu(menu);
        }
        sync_window_title(app, lang);
        let _ = app.emit("locale-changed", lang);
        return;
    }
    let dir = match id {
        "open_data" => cache::data_dir(),
        "open_cache" => cache::cache_dir(),
        "open_logs" => cache::logs_dir(),
        _ => return,
    };
    if let Err(e) = std::process::Command::new("open").arg(&dir).spawn() {
        tracing::warn!(error = %e, dir = %dir.display(), "打开目录失败");
    }
}

/// 前端切换语言后调用：按新语言重建原生菜单。与当前 locale 相同则跳过，避免无谓重建。
#[tauri::command]
pub fn set_locale(app: AppHandle, lang: String) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        let mut cur = state.locale.lock().unwrap_or_else(|e| e.into_inner());
        if *cur == lang {
            return Ok(());
        }
        *cur = lang.clone();
    }
    let menu = build_menu(&app, &lang).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    sync_window_title(&app, &lang);
    Ok(())
}
