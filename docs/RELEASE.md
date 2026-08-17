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

## macOS 서명·공증 (2026-08-04 도입)

`Developer ID Application: Prompt Technology, Co., Ltd. (P4S6KATL7C)` 로
번들을 서명하고(hardened runtime 포함) Apple notary 서비스에 공증합니다.
tauri-action이 `APPLE_*` 환경변수만 있으면 인증서 임포트 → 서명 → 공증
제출 → 스테이플까지 자동 처리하므로 워크플로에 별도 스텝이 없습니다
(App Store Connect API 키 파일 쓰기 스텝 제외).

브라우저로 받은 dmg도 Gatekeeper를 그대로 통과하므로 과거의
`xattr -cr` 우회 안내는 필요 없습니다 (v0.5.3 이전 릴리스에만 해당).

필요한 GitHub Secrets:

| Secret | 내용 |
|--------|------|
| `APPLE_CERTIFICATE` | Developer ID Application 인증서 `.p12`의 base64 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 내보내기 비밀번호 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Prompt Technology, Co., Ltd. (P4S6KATL7C)` |
| `APPLE_API_KEY` | App Store Connect API Key ID (10자리) |
| `APPLE_API_ISSUER` | App Store Connect API Issuer ID (UUID) |
| `APPLE_API_KEY_CONTENT` | API 키 `.p8` 파일 내용 (공증 인증용) |

- 인증서 유효기간은 **5년**. 만료 전 재발급 후 `.p12`를 다시 내보내
  `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD`만 교체하면 됩니다.
- 인증서를 포털에서 폐기(revoke)하면 기존 배포본의 Gatekeeper 통과에
  영향이 갈 수 있으니 재발급을 남발하지 않습니다.
- 로컬 서명 빌드: `APPLE_SIGNING_IDENTITY="Developer ID Application: ..." pnpm tauri build`
  (공증 없이 서명만 하며, `TAURI_SIGNING_PRIVATE_KEY`가 없어 마지막
  업데이터 아카이브 서명 단계에서 실패하지만 `.app`/`.dmg`는 생성됨).
- 로컬 공증 확인: `xcrun notarytool submit <dmg> --key <p8> --key-id <ID> --issuer <UUID> --wait`

### 리소스 안 네이티브 바이너리 서명 (2026-08-17 추가)

공증은 아카이브 **안의 모든 Mach-O**를 검사한다. Tauri 는 `.app` 껍데기만
서명하고 `Contents/Resources/` 로 복사된 바이너리는 건드리지 않으므로,
서명되지 않은 것이 하나라도 있으면 아카이브 전체가 거부된다.

v0.6.0 1차 시도가 이걸로 실패했다 — PDF 엔진 교체 때 들어온
`@firecrawl/pdf-inspector` 의 NAPI 바이너리가 원인이었다.

```
pdf-inspector.darwin-arm64.node
  The binary is not signed with a valid Developer ID certificate.
  The signature does not include a secure timestamp.
```

릴리스 워크플로의 **Sign bundled native binaries** 스텝이
`packages/app/scripts/sign-macos-resources.mjs` 로 리소스 안의 Mach-O 를 훑어
서명한다. 서명은 Mach-O 안에 들어가므로 이후 `.app` 으로 복사돼도 살아남는다.

**왜 워크플로 스텝인가** — 처음에는 `beforeBundleCommand` 훅에 걸었는데
`The specified item could not be found in the keychain` 으로 실패했다.
인증서를 키체인에 올리는 주체는 tauri-action 이 아니라 **Tauri CLI 자신**이고,
그 시점이 번들링 도중이라 훅이 도는 때에는 아직 키체인이 비어 있다. 그래서
스텝에서 임시 키체인을 직접 만들어 서명하고 곧바로 되돌린다 (검색 목록 복원 +
키체인 삭제). Tauri 는 이후 자기 키체인을 따로 만들어 `.app` 을 서명한다.

주의할 점 세 가지:

- **NAPI 바이너리는 ad-hoc(linker-signed) 상태로 배포된다.** `codesign
  --verify` 는 통과하므로 "서명돼 있나"만 보면 놓친다. 발급 기관이
  `Developer ID Application` 인지까지 봐야 한다.
- 번들된 Node 는 이미 Developer ID 서명(OpenJS)이라 다시 서명하지 않는다.
  JRE 는 `tar.gz` 안에 있어 애초에 검사 대상이 아니다 — 지금껏 이 문제가
  드러나지 않은 이유다.

- 번들 Node 는 `com.apple.security.cs.disable-library-validation` 을 갖고
  있어, 우리 Team ID 로 서명한 `.node` 도 정상적으로 로드한다. 이 엔타이틀먼트가
  없는 런타임에 네이티브 애드온을 물릴 때는 서명만으로 부족하다.

파일 이름을 박지 않고 리소스 전체를 훑으므로 새 네이티브 의존성이 들어와도
자동으로 걸린다. 스크립트 자체는 darwin 이 아니거나 `APPLE_SIGNING_IDENTITY`
가 없으면 조용히 지나가므로 로컬 빌드에서도 안전하다.

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
