/**
 * OLE2 사전 검증기(`guard.ts`)의 거부 사유.
 *
 * `cfb` 는 의존성이 아니라 호출 대상이다 — 이 검증기는 `CFB.read` 앞에서 돌아
 * 적대적 OLE2(FAT·DIFAT·디렉터리 순환, 중간 체인을 가리키는 항목 다수 등)를
 * 걸러낸다. 호출자(.hwp·.xls)는 이 사유를 각자의 오류 체계로 옮긴다:
 *   - CORRUPTED → .hwp: HwpConversionError('CORRUPTED'), .xls: 손상 한국어 Error
 *   - TOO_LARGE → .hwp: HwpConversionError('TOO_LARGE'), .xls: 과대 한국어 Error
 */
export type Ole2GuardReason = "CORRUPTED" | "TOO_LARGE";

export class Ole2GuardError extends Error {
  readonly reason: Ole2GuardReason;

  constructor(reason: Ole2GuardReason, detail: string) {
    super(detail);
    this.name = "Ole2GuardError";
    this.reason = reason;
  }
}
