//! paper-md-studio Windows sidecar shim
//!
//! Tauri 의 `Command.sidecar(...)` 가 Windows 에서 `CreateProcessW` 로 .exe 를
//! 실행하므로, .cmd 배치 파일을 .exe 이름으로 복사하면 PE32+ 헤더 검증에 실패한다.
//! 이 shim 은 진짜 PE 바이너리를 sidecar 자리에 두기 위한 얇은 런처이다.
//!
//! 책임:
//!   1. 번들 JRE (`resources/jre.tar.gz`) 를 `%LOCALAPPDATA%/com.paper-md-studio.app/jre` 로
//!      첫 실행 시 추출 (sentinel = archive size).
//!   2. `PAPER_MD_STUDIO_HWP_JAR`, `JAVA_HOME`, `PATH` 환경변수 세팅.
//!   3. 배포 모드: `resources/node/node.exe resources/cli/index.js <args>` 실행.
//!   4. 개발 모드: `git rev-parse --show-toplevel` 로 모노레포 루트 찾고
//!      `node packages/cli/dist/index.js <args>` 실행.
//!
//! stdio 는 모두 inherit, 자식 exit code 를 그대로 전파한다.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

use anyhow::{Context, Result, anyhow};
use flate2::read::GzDecoder;
use tar::Archive;

const APP_DATA_DIRNAME: &str = "com.paper-md-studio.app";
const JRE_DIRNAME: &str = "jre";
const JRE_STAMP: &str = "jre.stamp";
const JRE_ARCHIVE: &str = "jre.tar.gz";
const HWP_JAR: &str = "hwp-to-hwpx.jar";

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

    if let Some(ref res) = resources_dir {
        prepare_runtime(res)?;
    }

    // 1. 배포 모드: 번들 node + CLI
    if let Some(ref res) = resources_dir {
        let bundled_node = res.join("node").join("node.exe");
        let bundled_cli = res.join("cli").join("index.js");
        if bundled_node.is_file() && bundled_cli.is_file() {
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

fn prepare_runtime(resources: &Path) -> Result<()> {
    // jre.tar.gz 가 있으면 추출 + JAVA_HOME/PATH 설정
    let jre_archive = resources.join(JRE_ARCHIVE);
    if jre_archive.is_file() {
        let jre_dir = ensure_jre_extracted(&jre_archive)?;
        // SAFETY: 단일 스레드 main 진입점에서만 호출되며, 이 프로세스 한정.
        unsafe {
            env::set_var("JAVA_HOME", &jre_dir);
        }
        prepend_path(jre_dir.join("bin"));
    }

    // hwp-to-hwpx.jar 경로 환경변수 (사용자가 명시 override 안 한 경우만)
    let jar_path = resources.join(HWP_JAR);
    if jar_path.is_file() && env::var_os("PAPER_MD_STUDIO_HWP_JAR").is_none() {
        unsafe {
            env::set_var("PAPER_MD_STUDIO_HWP_JAR", &jar_path);
        }
    }
    Ok(())
}

/// `jre.tar.gz` 를 `%LOCALAPPDATA%/com.paper-md-studio.app/jre` 로 추출한다.
/// sentinel: 아카이브 파일 크기를 `jre.stamp` 에 저장하여 변경 시 재추출.
fn ensure_jre_extracted(archive: &Path) -> Result<PathBuf> {
    let archive_size = fs::metadata(archive)
        .with_context(|| format!("아카이브 메타데이터 조회 실패: {}", archive.display()))?
        .len();

    let app_data = local_app_data()?.join(APP_DATA_DIRNAME);
    let jre_dir = app_data.join(JRE_DIRNAME);
    let stamp_file = app_data.join(JRE_STAMP);
    let java_exe = jre_dir.join("bin").join("java.exe");

    let stored_size = fs::read_to_string(&stamp_file)
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok());

    let needs_extract = !java_exe.is_file() || stored_size != Some(archive_size);
    if !needs_extract {
        return Ok(jre_dir);
    }

    eprintln!("번들 JRE 추출 중... ({})", app_data.display());
    fs::create_dir_all(&app_data)
        .with_context(|| format!("앱 데이터 디렉토리 생성 실패: {}", app_data.display()))?;
    if jre_dir.exists() {
        fs::remove_dir_all(&jre_dir)
            .with_context(|| format!("기존 JRE 제거 실패: {}", jre_dir.display()))?;
    }

    let file = fs::File::open(archive)
        .with_context(|| format!("아카이브 열기 실패: {}", archive.display()))?;
    let gz = GzDecoder::new(file);
    let mut tar = Archive::new(gz);
    tar.unpack(&app_data)
        .with_context(|| format!("JRE 추출 실패: {} -> {}", archive.display(), app_data.display()))?;

    fs::write(&stamp_file, archive_size.to_string())
        .with_context(|| format!("sentinel 기록 실패: {}", stamp_file.display()))?;
    Ok(jre_dir)
}

fn local_app_data() -> Result<PathBuf> {
    if let Some(p) = env::var_os("LOCALAPPDATA") {
        return Ok(PathBuf::from(p));
    }
    // 비-Windows 환경 (테스트/개발) 폴백
    if let Some(home) = env::var_os("HOME") {
        return Ok(PathBuf::from(home).join(".local").join("share"));
    }
    Err(anyhow!("LOCALAPPDATA 환경변수를 찾을 수 없습니다"))
}

fn prepend_path<P: AsRef<Path>>(dir: P) {
    let dir = dir.as_ref();
    let mut paths = match env::var_os("PATH") {
        Some(p) => env::split_paths(&p).collect::<Vec<_>>(),
        None => Vec::new(),
    };
    paths.insert(0, dir.to_path_buf());
    if let Ok(joined) = env::join_paths(paths) {
        // SAFETY: main 단일 스레드 진입점에서만 호출.
        unsafe {
            env::set_var("PATH", joined);
        }
    }
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
mod tests {
    use super::*;
    use std::io::Write;

    fn make_tar_gz(dir: &Path, archive: &Path) -> std::io::Result<()> {
        let tar_path = dir.join("inner.tar");
        {
            let file = fs::File::create(&tar_path)?;
            let mut builder = tar::Builder::new(file);
            // jre/bin/java.exe (dummy)
            let java_dir = dir.join("jre").join("bin");
            fs::create_dir_all(&java_dir)?;
            let java_exe = java_dir.join("java.exe");
            fs::write(&java_exe, b"MZdummy")?;
            builder.append_dir_all("jre", dir.join("jre"))?;
            builder.finish()?;
        }
        let tar_bytes = fs::read(&tar_path)?;
        let gz_file = fs::File::create(archive)?;
        let mut encoder = flate2::write::GzEncoder::new(gz_file, flate2::Compression::default());
        encoder.write_all(&tar_bytes)?;
        encoder.finish()?;
        fs::remove_file(&tar_path)?;
        fs::remove_dir_all(dir.join("jre"))?;
        Ok(())
    }

    #[test]
    fn ensure_jre_extracted_creates_runtime() {
        let tmp = tempdir();
        let archive = tmp.join("jre.tar.gz");
        make_tar_gz(&tmp, &archive).expect("test archive");

        // LOCALAPPDATA 를 임시 디렉토리로 redirect
        unsafe {
            env::set_var("LOCALAPPDATA", &tmp);
        }
        let jre = ensure_jre_extracted(&archive).expect("first extract");
        let java = jre.join("bin").join("java.exe");
        assert!(java.is_file(), "java.exe 가 추출되어야 함");

        // 두 번째 호출은 sentinel 일치로 skip
        let mtime_before = fs::metadata(&java).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let _ = ensure_jre_extracted(&archive).expect("second extract");
        let mtime_after = fs::metadata(&java).unwrap().modified().unwrap();
        assert_eq!(mtime_before, mtime_after, "재추출되면 안 됨");
    }

    #[test]
    fn ensure_jre_extracted_reextracts_on_size_change() {
        let tmp = tempdir();
        let archive = tmp.join("jre.tar.gz");
        make_tar_gz(&tmp, &archive).expect("first archive");

        unsafe {
            env::set_var("LOCALAPPDATA", &tmp);
        }
        ensure_jre_extracted(&archive).expect("first");

        // 다른 size 의 아카이브로 교체
        let tmp2 = tmp.join("inner2");
        fs::create_dir_all(&tmp2).unwrap();
        make_tar_gz(&tmp2, &archive).expect("second archive");
        // 약간의 차이를 주기 위해 패딩 추가
        let mut f = fs::OpenOptions::new().append(true).open(&archive).unwrap();
        f.write_all(b"padding").unwrap();
        drop(f);

        // 추출 트리거되어야 함 (sentinel 불일치)
        let res = ensure_jre_extracted(&archive);
        assert!(res.is_ok(), "변경된 아카이브로 재추출 성공해야 함");
    }

    #[test]
    fn clamp_u8_handles_edges() {
        assert_eq!(clamp_u8(0), 0);
        assert_eq!(clamp_u8(1), 1);
        assert_eq!(clamp_u8(255), 255);
        assert_eq!(clamp_u8(256), 0);
        assert_eq!(clamp_u8(-1), 1);
    }

    fn tempdir() -> PathBuf {
        let base = env::temp_dir().join(format!(
            "paper-md-shim-test-{}",
            std::process::id()
        ));
        let unique = base.join(format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&unique).unwrap();
        unique
    }
}
