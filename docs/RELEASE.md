# 릴리스 & 자동 업데이트

## 배포 자산

릴리스마다 GitHub Releases에 다음이 올라갑니다.

| 파일 | 플랫폼 | 용도 |
|------|--------|------|
| `Paper.MD.Studio_<ver>_aarch64.dmg` | macOS (Apple Silicon) | 최초 설치 |
| `Paper.MD.Studio_aarch64.app.tar.gz` (+ `.sig`) | macOS | **자동 업데이트 페이로드** |
| `Paper.MD.Studio_<ver>_x64-setup.exe` (+ `.sig`) | Windows | 최초 설치 + **자동 업데이트 페이로드** |
| `latest.json` | 공통 | 업데이터가 조회하는 버전 매니페스트 |

`.msi`는 배포하지 않습니다. NSIS(`.exe`)와 같은 앱의 중복 설치 형식이라
받는 쪽에 혼란만 주고, 관리자 권한 없이 설치되는 NSIS가 자동 업데이트와도
잘 맞기 때문입니다 (`bundle.targets: ["app", "dmg", "nsis"]`).

> 과거 릴리스 자산은 지우지 않습니다. 공개 저장소의 릴리스 자산은 저장소
> 용량·대역폭 제한 대상이 아니며(파일당 2 GiB, 릴리스당 1,000개만 제한),
> 회귀 발생 시 롤백과 버그 재현에 필요합니다.

## 서명 키 (최초 1회)

자동 업데이트는 minisign 키로 서명된 아카이브만 설치합니다.
**이 키를 잃으면 기존 사용자에게 업데이트를 배포할 방법이 영영 사라집니다.**

```bash
# 1. 키 생성 (비밀번호를 물어봅니다 — 빈 값도 가능)
pnpm --filter @paper-md-studio/app tauri signer generate -w ~/.tauri/paper-md-studio.key

# 2. 출력된 공개키를 tauri.conf.json의 plugins.updater.pubkey 에 넣습니다
#    (~/.tauri/paper-md-studio.key.pub 파일에도 동일한 값이 있습니다)

# 3. 개인키와 비밀번호를 GitHub Secret에 등록
gh secret set TAURI_SIGNING_PRIVATE_KEY \
  --repo iskim1018/paper-md-studio < ~/.tauri/paper-md-studio.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
  --repo iskim1018/paper-md-studio   # 프롬프트에 비밀번호 입력 (없으면 빈 줄)
```

`~/.tauri/paper-md-studio.key`는 **저장소에 커밋하지 말고** 비밀번호 관리자
등에 따로 백업하세요.

## 릴리스 절차

1. 버전 6곳 갱신: 루트 `package.json`, `packages/app/package.json`,
   `packages/app/src-tauri/tauri.conf.json`,
   `packages/app/src-tauri/Cargo.toml`,
   `packages/app/src-tauri/Cargo.lock`의 `paper-md-studio` 항목,
   `packages/cli/src/index.ts`의 `--version` 출력
2. `CHANGELOG.md`에 항목 추가 (Keep a Changelog 한국어 형식)
3. `chore(release): vX.Y.Z` 커밋 → `git tag vX.Y.Z` → main과 태그 push
4. 태그 push가 webhook 누락으로 Release 워크플로를 안 태우면 재푸시:
   `git push origin :refs/tags/vX.Y.Z && git push origin vX.Y.Z`
5. tauri-action이 릴리스를 **draft로 생성**하므로 게시 필요:
   `gh release edit vX.Y.Z --repo iskim1018/paper-md-studio --draft=false`

5번을 빠뜨리면 다운로드가 안 될 뿐 아니라 **자동 업데이트도 동작하지
않습니다.** 업데이터 엔드포인트가 `releases/latest/download/latest.json`
이라 published 상태의 최신 릴리스만 바라보기 때문입니다.

## 업데이트 동작

- 앱 시작 3초 뒤 조용히 확인합니다 (`useAppUpdate`).
- 새 버전이 있을 때만 헤더 아래 배너로 알립니다. 설치는 사용자가 누른
  뒤에만 진행되며, 완료되면 앱이 자동 재시작합니다.
- 확인 실패(네트워크 단절, Tauri 런타임 없는 개발 서버 등)는 무시합니다 —
  업데이트 확인 실패가 앱 사용을 막을 이유는 없습니다.
