# Legacy sidecar 자료 (제거 예정)

이 디렉토리는 다음 릴리스에서 제거됩니다.

## sidecar-wrapper.cmd

2026-04-29 이전까지 Windows sidecar 로 사용되던 배치 스크립트입니다.
`Tauri Command.sidecar(...)` 가 `CreateProcessW` 로 PE32+ 헤더를 검사하기 때문에
`.cmd` 를 `.exe` 이름으로 복사하면 다음 오류로 실행이 거부됩니다.

> 프로그램 또는 기능 paper-md-studio-cli.exe 이(가) 64비트 버전 Windows와 호환되지 않기 때문에 시작 또는 실행할 수 없습니다.

대체: [`packages/app/sidecar-shim/`](../../sidecar-shim/) Rust crate 가
PE32+ 바이너리를 산출합니다. 동일한 책임을 수행합니다.

## 롤백 절차

회귀가 필요하다면 (긴급 hotfix 한정):

1. `packages/app/scripts/install-sidecar.mjs` 의 Windows 분기를
   `sidecar-wrapper.cmd` 복사로 revert.
2. 본 디렉토리의 `.cmd` 파일을 `packages/app/scripts/sidecar-wrapper.cmd` 로 이동.

단, PE 호환성 오류가 다시 재현되므로 임시 조치만 가능합니다.
