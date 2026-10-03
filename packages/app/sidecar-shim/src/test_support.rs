//! 테스트 전용 도우미.

use std::env;
use std::fs;
use std::io::ErrorKind;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// 테스트 하나가 혼자 쓰는 임시 디렉토리. drop 시 통째로 지운다.
///
/// cargo 는 테스트를 같은 pid 의 병렬 스레드로 돌리고 macOS 시계는 마이크로초
/// 해상도라, pid·시각만으로 이름을 지으면 두 테스트가 같은 디렉토리를 받는다.
/// 그래서 프로세스 안 카운터로 이름을 나누고, `create_dir` 이 이미 있는 경로를
/// 거부하는 원자성으로 이전 실행(같은 pid 재사용)의 잔여물과도 섞이지 않게 한다.
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new() -> Self {
        static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
        let base = env::temp_dir();
        loop {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let path = base.join(format!("paper-md-shim-test-{}-{id}", std::process::id()));
            match fs::create_dir(&path) {
                Ok(()) => return Self(path),
                Err(err) if err.kind() == ErrorKind::AlreadyExists => continue,
                Err(err) => panic!("임시 디렉토리 생성 실패: {}: {err}", path.display()),
            }
        }
    }
}

impl Deref for TempDir {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // 정리 실패는 테스트 결과와 무관하다 — 다음 실행은 새 이름을 받는다.
        let _ = fs::remove_dir_all(&self.0);
    }
}
