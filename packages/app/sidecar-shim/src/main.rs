//! paper-md-studio Windows sidecar shim
//!
//! Tauri 의 `Command.sidecar(...)` 가 Windows 에서 `CreateProcessW` 로 .exe 를
//! 실행하므로, .cmd 배치 파일을 .exe 이름으로 복사하면 PE32+ 헤더 검증에 실패한다.
//! 이 shim 은 진짜 PE 바이너리를 sidecar 자리에 두기 위한 얇은 런처이다.
//!
//! 책임:
//!   1. 배포 모드: `resources/node/node.exe resources/cli/index.js <args>` 실행.
//!   2. 개발 모드: `git rev-parse --show-toplevel` 로 모노레포 루트 찾고
//!      `node packages/cli/dist/index.js <args>` 실행.
//!   3. 배포 모드에서 0.6.x 가 남긴 JRE 를 백그라운드로 정리 (`legacy_jre`, 0.8.0 이후 제거).
//!
//! stdio 는 모두 inherit, 자식 exit code 를 그대로 전파한다.

use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

use anyhow::{Context, Result, anyhow};

mod legacy_jre;

fn main() -> ExitCode {
    let argv: Vec<OsString> = env::args_os().skip(1).collect();
    match run(&argv) {
        Ok(code) => ExitCode::from(clamp_u8(code)),
        Err(err) => {
            eprintln!("paper-md-studio sidecar shim 오류: {err:#}");
            ExitCode::from(1)
        }
    }
}

fn run(argv: &[OsString]) -> Result<i32> {
    let exe_path = env::current_exe().context("current_exe 조회 실패")?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| anyhow!("실행파일의 부모 디렉토리를 찾을 수 없습니다"))?;

    // Tauri Windows 번들 레이아웃: <install>/sidecar.exe + <install>/resources/
    // dev 모드 (`tauri dev`): target/debug/sidecar.exe + target/debug/resources/
    // 두 후보 모두 시도하여 robust 하게 동작.
    let resources_dir = locate_resources(exe_dir);

    // 1. 배포 모드: 번들 node + CLI
    if let Some(ref res) = resources_dir {
        let bundled_node = res.join("node").join("node.exe");
        let bundled_cli = res.join("cli").join("index.js");
        if bundled_node.is_file() && bundled_cli.is_file() {
            // 0.8.0 이후 제거. 설치본에서만 돈다 — 개발 실행이 같은 PC 의 설치 데이터를 건드리지 않게.
            legacy_jre::spawn_cleanup();
            return spawn(&bundled_node, &[bundled_cli.as_os_str().into()], argv);
        }
    }

    // 2. 개발 모드: git rev-parse 로 모노레포 루트 → packages/cli/dist/index.js
    let mono_root = find_monorepo_root(exe_dir).context(
        "배포 리소스를 찾지 못했고 모노레포 루트도 찾을 수 없습니다 (개발 모드 진입 실패)",
    )?;
    let dev_cli = mono_root
        .join("packages")
        .join("cli")
        .join("dist")
        .join("index.js");
    if !dev_cli.is_file() {
        return Err(anyhow!(
            "개발 모드 CLI 산출물이 없습니다: {}\n먼저 `pnpm --filter @paper-md-studio/cli build` 를 실행하세요.",
            dev_cli.display()
        ));
    }
    let node = which("node").unwrap_or_else(|| PathBuf::from("node"));
    spawn(&node, &[dev_cli.as_os_str().into()], argv)
}

fn locate_resources(exe_dir: &Path) -> Option<PathBuf> {
    // 우선순위:
    //   <exe_dir>/resources       (Tauri Windows 배포 + dev 둘 다)
    //   <exe_dir>/../resources    (안전망)
    let candidates = [exe_dir.join("resources"), exe_dir.join("..").join("resources")];
    candidates.into_iter().find(|p| p.is_dir())
}

fn find_monorepo_root(start: &Path) -> Result<PathBuf> {
    let output = Command::new("git")
        .args(["-C"])
        .arg(start)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .context("git 실행 실패 (PATH 에 git 이 없을 수 있습니다)")?;
    if !output.status.success() {
        return Err(anyhow!(
            "git rev-parse --show-toplevel 실패 (status: {})",
            output.status
        ));
    }
    let stdout =
        String::from_utf8(output.stdout).context("git 출력의 UTF-8 디코드 실패")?;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("git 출력이 비어 있습니다"));
    }
    Ok(PathBuf::from(trimmed))
}

fn which(name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    let exts: Vec<OsString> = env::var_os("PATHEXT")
        .map(|p| env::split_paths(&p).map(|p| p.into_os_string()).collect())
        .unwrap_or_else(|| vec![OsString::from("")]);
    for dir in env::split_paths(&path_var) {
        let base = dir.join(name);
        if base.is_file() {
            return Some(base);
        }
        for ext in &exts {
            let mut p = base.clone().into_os_string();
            p.push(ext);
            let pb = PathBuf::from(p);
            if pb.is_file() {
                return Some(pb);
            }
        }
    }
    None
}

fn spawn(program: &Path, leading: &[OsString], rest: &[OsString]) -> Result<i32> {
    let status = Command::new(program)
        .args(leading)
        .args(rest)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("자식 프로세스 실행 실패: {}", program.display()))?;
    Ok(status.code().unwrap_or(1))
}

fn clamp_u8(code: i32) -> u8 {
    if code < 0 {
        1
    } else if code > 255 {
        u8::try_from(code & 0xFF).unwrap_or(1)
    } else {
        u8::try_from(code).unwrap_or(1)
    }
}

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::fs;

    #[test]
    fn locate_resources_prefers_sibling_dir() {
        let tmp = TempDir::new();
        let exe_dir = tmp.join("app");
        fs::create_dir_all(exe_dir.join("resources")).unwrap();
        fs::create_dir_all(tmp.join("resources")).unwrap();

        assert_eq!(locate_resources(&exe_dir), Some(exe_dir.join("resources")));
    }

    #[test]
    fn locate_resources_falls_back_to_parent_dir() {
        let tmp = TempDir::new();
        let exe_dir = tmp.join("app");
        fs::create_dir_all(&exe_dir).unwrap();
        fs::create_dir_all(tmp.join("resources")).unwrap();

        assert_eq!(
            locate_resources(&exe_dir),
            Some(exe_dir.join("..").join("resources"))
        );
    }

    #[test]
    fn locate_resources_returns_none_without_resources() {
        let tmp = TempDir::new();
        let exe_dir = tmp.join("app");
        fs::create_dir_all(&exe_dir).unwrap();

        assert_eq!(locate_resources(&exe_dir), None);
    }

    /// 병렬 스레드(같은 pid)가 동시에 만들어도 임시 디렉토리가 겹치지 않아야 한다.
    /// 겹치면 한 테스트가 만든 `resources/` 를 다른 테스트가 보고 실패한다.
    #[test]
    fn temp_dir_is_unique_across_parallel_threads() {
        const THREADS: usize = 8;
        const PER_THREAD: usize = 50;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(THREADS));
        let handles: Vec<_> = (0..THREADS)
            .map(|_| {
                let barrier = std::sync::Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    (0..PER_THREAD).map(|_| TempDir::new()).collect::<Vec<_>>()
                })
            })
            .collect();
        let dirs: Vec<TempDir> = handles
            .into_iter()
            .flat_map(|h| h.join().unwrap())
            .collect();
        let unique: std::collections::HashSet<&Path> = dirs.iter().map(|d| &**d).collect();

        assert_eq!(unique.len(), THREADS * PER_THREAD);
    }

    #[test]
    fn clamp_u8_handles_edges() {
        assert_eq!(clamp_u8(0), 0);
        assert_eq!(clamp_u8(1), 1);
        assert_eq!(clamp_u8(255), 255);
        assert_eq!(clamp_u8(256), 0);
        assert_eq!(clamp_u8(-1), 1);
    }
}
