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

/// A6 §9: 시크릿 조회/저장은 `/usr/bin/security` CLI 패턴만 쓴다(서드파티 keychain 플러그인
/// 없음 — Task 9 산출물, US-A31 재작업 메모 참고). 인자 생성은 순수 함수로 분리해 테스트한다.
fn add_generic_password_args(service: &str, account: &str) -> Vec<String> {
    vec![
        "add-generic-password".into(),
        "-U".into(),
        "-s".into(),
        service.into(),
        "-a".into(),
        account.into(),
        "-w".into(),
    ]
}

#[tauri::command]
fn keychain_set(service: String, account: String, secret: String) -> Result<(), String> {
    use std::process::Command;
    let mut args = add_generic_password_args(&service, &account);
    args.push(secret);
    let status = Command::new("/usr/bin/security")
        .args(&args)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("security exited with status {status}"))
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![keychain_set])
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

#[cfg(test)]
mod keychain_tests {
    use super::add_generic_password_args;

    #[test]
    fn builds_the_expected_security_cli_flags() {
        // 계약 §9: Slack bot 토큰의 실제 서비스명은 omnis.slack.xoxb.<team_id>, account는 <team_id>(계약 리뷰 M7).
        let args = add_generic_password_args("omnis.slack.xoxb.T123", "T123");
        assert_eq!(
            args,
            vec!["add-generic-password", "-U", "-s", "omnis.slack.xoxb.T123", "-a", "T123", "-w"]
        );
    }
}
