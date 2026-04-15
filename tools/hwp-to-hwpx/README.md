# hwp-to-hwpx

paper-md-studio에서 사용하는 HWP → HWPX 변환 CLI 래퍼.

`neolord0/hwp2hwpx` (Apache-2.0) Java 라이브러리를 내부적으로 사용하여
HWP 5.0 바이너리 파일을 HWPX(OWPML) 포맷으로 변환합니다. 변환된 HWPX는
기존 paper-md-studio의 HWPX 파이프라인에 위임되어 Markdown으로 렌더링됩니다.

## 요구사항

- JDK 11+
- Maven 3.6+

## 빌드

```bash
cd tools/hwp-to-hwpx
mvn -B clean package
```

생성물: `target/hwp-to-hwpx.jar` (maven-shade-plugin fat jar).

의존성은 JitPack(`https://jitpack.io`)을 통해 `neolord0/hwp2hwpx`를
커밋 SHA 고정으로 가져옵니다. 최초 빌드는 JitPack 서버에서 의존성이
준비되기까지 수 분이 걸릴 수 있습니다.

## 실행

```bash
java -jar target/hwp-to-hwpx.jar <input.hwp> <output.hwpx>
```

### 종료 코드

| 코드 | 의미 |
|------|------|
| 0    | 성공 |
| 1    | 잘못된 인자 |
| 2    | HWP 파일 읽기/파싱 실패 |
| 3    | HWP → HWPX 변환 실패 |
| 4    | HWPX 파일 저장 실패 |

오류 메시지는 모두 한국어로 stderr에 출력됩니다.

## 배포

빌드된 `target/hwp-to-hwpx.jar`는 `packages/core/resources/`로 복사되어
core 패키지에 번들됩니다 (다음 태스크).
