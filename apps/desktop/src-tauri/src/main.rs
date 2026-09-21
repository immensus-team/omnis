#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

/// A5 §1.5: tells the frontend via `<html data-vibrancy>` whether native glass was applied or whether it
/// downgraded to the CSS `.glass-surface` fallback.
fn vibrancy_attr(applied: bool) -> &'static str {
    if applied { "native" } else { "css-fallback" }
}

#[cfg(target_os = "macos")]
fn apply_glass(window: &tauri::WebviewWindow) -> bool {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
    // A5 §1.5 says to try apply_liquid_glass (macOS 26 Tahoe) first, but the published window-vibrancy
    // versions (0.5.3/0.6.0, the latest on crates.io at this point) do not have apply_liquid_glass — the
    // very API A5 §1.5 warned may still be unstable in "2026-09 in progress". So only apply_vibrancy
    // (Sidebar) is applied, and if even that fails vibrancy_attr() below falls back to css-fallback.
    apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None).is_ok()
}

#[cfg(not(target_os = "macos"))]
fn apply_glass(_window: &tauri::WebviewWindow) -> bool {
    false
}

/// A6 §9: reading and storing secrets uses only the `/usr/bin/security` CLI pattern (no third-party
/// keychain plugin — Task 9 output, see the US-A31 rework note). Argument building is split into pure
/// functions so it can be tested.
fn add_generic_password_args(service: &str, account: &str) -> Vec<String> {
    vec![
        "add-generic-password".into(),
        "-s".into(),
        service.into(),
        "-a".into(),
        account.into(),
        "-w".into(),
    ]
}

/// A6 §9: a generic-password item is keyed by (service, account), so `add-generic-password -U` only ever
/// replaces an item whose account matches too. An item left under a different account would survive as a
/// *second* item on the same service, and every reader resolves by service name alone — so the re-store
/// would look successful while a read could still return the stale secret. `keychain_set` deletes the
/// service first; this builds those args.
fn delete_generic_password_args(service: &str) -> Vec<String> {
    vec!["delete-generic-password".into(), "-s".into(), service.into()]
}

#[tauri::command]
fn keychain_set(service: String, account: String, secret: String) -> Result<(), String> {
    use std::process::Command;
    // Delete the service first, then add. `security` exits non-zero when there is nothing to delete —
    // the normal first-store case — so that status is deliberately ignored; the add reports failure.
    // `-U` went with it: if an item somehow survives the delete, a plain add now fails with "already
    // exists" instead of quietly writing a second item beside it.
    let _ = Command::new("/usr/bin/security")
        .args(delete_generic_password_args(&service))
        .status();
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
    use super::{add_generic_password_args, delete_generic_password_args};

    #[test]
    fn deletes_the_service_so_a_re_store_replaces_instead_of_shadowing_it() {
        // A6 §9: the delete has to come first. Without it, storing again under a different account leaves
        // two items on the service and a service-only read can hand back the stale one.
        assert_eq!(
            delete_generic_password_args("omnis.slack.xoxb.T123"),
            vec!["delete-generic-password", "-s", "omnis.slack.xoxb.T123"]
        );
    }

    #[test]
    fn builds_the_expected_security_cli_flags() {
        // Contract §9: the Slack bot token's service is omnis.slack.xoxb.<team_id> and its account is
        // <team_id> (contract review M7). No `-U`: the delete above is what replaces an existing item, and
        // without `-U` a surviving item makes the add fail loudly instead of duplicating the service.
        let args = add_generic_password_args("omnis.slack.xoxb.T123", "T123");
        assert_eq!(
            args,
            vec!["add-generic-password", "-s", "omnis.slack.xoxb.T123", "-a", "T123", "-w"]
        );
    }
}
