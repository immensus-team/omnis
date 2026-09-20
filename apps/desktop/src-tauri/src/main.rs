#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

/// A5 §1.5: vibrancy가 성공하면 네이티브 유리, 실패하면 CSS `.glass-surface` 폴백으로
/// 다운그레이드한다는 사실을 `<html data-vibrancy>`로 프론트엔드에 알린다.
fn vibrancy_attr(applied: bool) -> &'static str {
    if applied { "native" } else { "css-fallback" }
}

#[cfg(target_os = "macos")]
fn apply_glass(window: &tauri::WebviewWindow) -> bool {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
    // A5 §1.5는 apply_liquid_glass(macOS 26 Tahoe)를 우선 시도하라고 하지만, window-vibrancy
    // 게시된 버전(0.5.3/0.6.0, 이 시점 crates.io 최신)에는 apply_liquid_glass가 없다(A5 §1.5가 이미
    // "2026-09 진행 중"으로 불안정할 수 있다고 경고한 그 API) — apply_vibrancy(Sidebar)만 적용하고,
    // 그마저 실패하면 아래 vibrancy_attr()이 css-fallback으로 내려간다.
    apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None).is_ok()
}

#[cfg(not(target_os = "macos"))]
fn apply_glass(_window: &tauri::WebviewWindow) -> bool {
    false
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window must exist (tauri.conf.json)");
            let applied = apply_glass(&window);
            let attr = vibrancy_attr(applied);
            window
                .eval(&format!("document.documentElement.dataset.vibrancy = '{attr}'"))
                .expect("failed to set data-vibrancy on <html>");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running omnis desktop");
}

#[cfg(test)]
mod tests {
    use super::vibrancy_attr;

    #[test]
    fn native_when_glass_applied() {
        assert_eq!(vibrancy_attr(true), "native");
    }

    #[test]
    fn css_fallback_when_glass_not_applied() {
        assert_eq!(vibrancy_attr(false), "css-fallback");
    }
}
