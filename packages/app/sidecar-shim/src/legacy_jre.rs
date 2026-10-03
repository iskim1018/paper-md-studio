//! 0.6.x 이하가 앱 데이터에 풀어 둔 JRE 를 정리한다 — 0.8.0 이후 제거.
//!
//! 0.6.x 까지 shim 은 번들 `jre.tar.gz` 를 `%LOCALAPPDATA%\com.paper-md-studio.app\jre`
//! 에 풀고 아카이브 크기를 `jre.stamp` 에 남겼다. 0.7.0 에서 Java 경로가 사라져
//! 아무도 읽지 않지만, 업데이터는 설치 폴더만 바꾸므로 약 45MB 가 그대로 남는다.
//!
//! 같은 폴더에 WebView2 프로필(`EBWebView`) 등 다른 앱 데이터가 있으므로 `jre\` 와
//! `jre.stamp` 두 항목만 지운다. 변환을 막지 않도록 백그라운드 스레드에서 돌리고
//! 실패는 무시한다 — 변환이 먼저 끝나 지우다 말았으면 다음 실행에서 이어서 지운다.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread::{self, JoinHandle};

const APP_DATA_DIRNAME: &str = "com.paper-md-studio.app";
const JRE_DIRNAME: &str = "jre";
const JRE_STAMP: &str = "jre.stamp";

/// 0.6.x shim 이 JRE 를 풀던 자리 (`%LOCALAPPDATA%\com.paper-md-studio.app` 의 두 항목).
#[derive(Debug, PartialEq, Eq)]
struct LegacyJre {
    dir: PathBuf,
    stamp: PathBuf,
}

impl LegacyJre {
    /// `local_app_data` 가 절대경로일 때만 대상을 정한다. 빈 값·상대경로는 현재
    /// 디렉토리 기준으로 풀려 엉뚱한 `jre` 를 가리킬 수 있으므로 거부한다.
    fn under(local_app_data: &Path) -> Option<Self> {
        if !local_app_data.is_absolute() {
            return None;
        }
        let app_data = local_app_data.join(APP_DATA_DIRNAME);
        Some(Self {
            dir: app_data.join(JRE_DIRNAME),
            stamp: app_data.join(JRE_STAMP),
        })
    }

    fn is_present(&self) -> bool {
        is_real_dir(&self.dir) || is_real_file(&self.stamp)
    }

    /// 실패는 무시한다. 심볼릭 링크·정션은 0.6.x 가 만든 것이 아니므로 건드리지 않는다.
    fn remove(&self) {
        if is_real_dir(&self.dir) {
            let _ = fs::remove_dir_all(&self.dir);
        }
        if is_real_file(&self.stamp) {
            let _ = fs::remove_file(&self.stamp);
        }
    }
}

/// `%LOCALAPPDATA%` 에 남은 JRE 를 백그라운드에서 지우기 시작하고 바로 돌아온다.
pub fn spawn_cleanup() {
    // JoinHandle 을 버려 기다리지 않는다 — shim 이 먼저 끝나면 스레드도 같이 끝난다.
    drop(spawn_cleanup_in(env::var_os("LOCALAPPDATA")));
}

fn spawn_cleanup_in(local_app_data: Option<OsString>) -> Option<JoinHandle<()>> {
    let legacy = LegacyJre::under(Path::new(&local_app_data?))?;
    if !legacy.is_present() {
        return None;
    }
    // `thread::spawn` 은 스레드 생성 실패 시 panic 하고 release 프로필은 panic=abort 라
    // 변환까지 죽는다. Builder 로 받아 실패하면 정리만 건너뛴다.
    thread::Builder::new()
        .name("legacy-jre-cleanup".into())
        .spawn(move || legacy.remove())
        .ok()
}

fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_dir())
}

fn is_real_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::fs;

    /// `<base>/com.paper-md-studio.app/` 아래에 0.6.x 가 남긴 JRE 와, 지우면 안 되는
    /// 다른 앱 데이터(WebView2 프로필·설정 파일·다른 앱의 jre)를 함께 깐다.
    fn seed_app_data(base: &Path) -> PathBuf {
        let app = base.join("com.paper-md-studio.app");
        fs::create_dir_all(app.join("jre").join("bin")).unwrap();
        fs::create_dir_all(app.join("jre").join("lib")).unwrap();
        fs::write(app.join("jre").join("bin").join("java.exe"), b"MZ").unwrap();
        fs::write(app.join("jre").join("lib").join("modules"), b"jimage").unwrap();
        fs::write(app.join("jre.stamp"), b"46137344").unwrap();
        fs::create_dir_all(app.join("EBWebView").join("Default")).unwrap();
        fs::write(
            app.join("EBWebView").join("Default").join("Preferences"),
            b"{}",
        )
        .unwrap();
        fs::write(app.join("settings.json"), b"{}").unwrap();
        fs::create_dir_all(base.join("other-app").join("jre")).unwrap();
        app
    }

    fn assert_other_data_kept(base: &Path, app: &Path) {
        assert!(app.is_dir(), "앱 데이터 폴더 자체는 남아야 함");
        assert!(
            app.join("EBWebView")
                .join("Default")
                .join("Preferences")
                .is_file()
        );
        assert!(app.join("settings.json").is_file());
        assert!(base.join("other-app").join("jre").is_dir());
    }

    #[test]
    fn under_points_at_jre_dir_and_stamp_in_app_data_dir() {
        let base = TempDir::new();
        let app = base.join("com.paper-md-studio.app");

        let legacy = LegacyJre::under(&base).expect("절대경로면 대상이 정해져야 함");

        assert_eq!(
            legacy,
            LegacyJre {
                dir: app.join("jre"),
                stamp: app.join("jre.stamp"),
            }
        );
    }

    #[test]
    fn under_rejects_empty_or_relative_base() {
        assert_eq!(LegacyJre::under(Path::new("")), None);
        assert_eq!(LegacyJre::under(Path::new("AppData")), None);
        assert_eq!(LegacyJre::under(Path::new(".")), None);
    }

    #[test]
    fn remove_deletes_only_jre_dir_and_stamp() {
        let base = TempDir::new();
        let app = seed_app_data(&base);
        let legacy = LegacyJre::under(&base).unwrap();
        assert!(legacy.is_present());

        legacy.remove();

        assert!(!app.join("jre").exists(), "jre/ 가 지워져야 함");
        assert!(!app.join("jre.stamp").exists(), "jre.stamp 가 지워져야 함");
        assert!(!legacy.is_present());
        assert_other_data_kept(&base, &app);
    }

    #[test]
    fn remove_finishes_partially_removed_leftovers() {
        let only_dir = TempDir::new();
        let app = seed_app_data(&only_dir);
        fs::remove_file(app.join("jre.stamp")).unwrap();
        let legacy = LegacyJre::under(&only_dir).unwrap();
        assert!(
            legacy.is_present(),
            "stamp 가 없어도 jre/ 가 있으면 정리 대상"
        );
        legacy.remove();
        assert!(!app.join("jre").exists());
        assert_other_data_kept(&only_dir, &app);

        let only_stamp = TempDir::new();
        let app = seed_app_data(&only_stamp);
        fs::remove_dir_all(app.join("jre")).unwrap();
        let legacy = LegacyJre::under(&only_stamp).unwrap();
        assert!(
            legacy.is_present(),
            "jre/ 가 없어도 stamp 가 있으면 정리 대상"
        );
        legacy.remove();
        assert!(!app.join("jre.stamp").exists());
        assert_other_data_kept(&only_stamp, &app);
    }

    #[test]
    fn nothing_to_do_without_leftovers() {
        let base = TempDir::new();
        let legacy = LegacyJre::under(&base).unwrap();
        assert!(!legacy.is_present());

        legacy.remove();

        assert!(
            !base.join("com.paper-md-studio.app").exists(),
            "없는 폴더를 만들면 안 됨"
        );
        assert!(spawn_cleanup_in(Some(base.as_os_str().to_owned())).is_none());
    }

    #[test]
    fn spawn_cleanup_in_removes_leftovers_on_background_thread() {
        let base = TempDir::new();
        let app = seed_app_data(&base);

        let handle = spawn_cleanup_in(Some(base.as_os_str().to_owned()))
            .expect("남은 JRE 가 있으면 정리 스레드가 떠야 함");
        handle.join().unwrap();

        assert!(!app.join("jre").exists());
        assert!(!app.join("jre.stamp").exists());
        assert_other_data_kept(&base, &app);
    }

    #[test]
    fn spawn_cleanup_in_skips_missing_or_relative_local_app_data() {
        assert!(spawn_cleanup_in(None).is_none());
        assert!(spawn_cleanup_in(Some(OsString::new())).is_none());
        assert!(spawn_cleanup_in(Some(OsString::from("AppData"))).is_none());
    }

    /// 심볼릭 링크는 0.6.x 가 만든 것이 아니다 — 링크를 따라가 대상을 지우면 안 된다.
    #[cfg(unix)]
    #[test]
    fn remove_leaves_symlinked_jre_and_its_target_alone() {
        let base = TempDir::new();
        let app = base.join("com.paper-md-studio.app");
        let outside = base.join("outside-jre");
        fs::create_dir_all(&app).unwrap();
        fs::create_dir_all(outside.join("bin")).unwrap();
        fs::write(outside.join("bin").join("java"), b"keep").unwrap();
        std::os::unix::fs::symlink(&outside, app.join("jre")).unwrap();
        let legacy = LegacyJre::under(&base).unwrap();
        assert!(!legacy.is_present());

        legacy.remove();

        assert!(
            outside.join("bin").join("java").is_file(),
            "링크 대상은 남아야 함"
        );
        assert!(
            app.join("jre").symlink_metadata().is_ok(),
            "링크도 건드리지 않음"
        );
    }
}
