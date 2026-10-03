/**
 * rhwp 의 content-loss 보고서(JSON) → 한국어 경고.
 *
 * rhwp 는 HWPX 로 내보내면서 담지 못한 내용(읽지 못한 첨부·표현 불가 개체 등)을
 * 별도 보고서로 돌려준다. 이걸 버리면 "변환은 성공했는데 내용이 빠진" 상태가
 * 사용자에게 보이지 않는다 — 조용한 손실 금지 원칙에 따라 경고로 올린다.
 * 같은 종류는 개수로 묶고, 내부 경로·ID 는 싣지 않는다.
 *
 * 스키마: `{ schemaVersion, outputFormat, count, losses: [{ code, subject, path, reason, resourceId? }] }`
 * (rhwp `src/serializer/content_loss.rs`, v0.8.6)
 */

const REASON_TEXT: Readonly<Record<string, string>> = {
  resourceReadFailedOrLimitExceeded: "읽기 실패 또는 크기 상한 초과",
  storedCompressionMismatch: "원본 압축 상태 불일치",
  rawPassthroughUnavailable: "원본 데이터 없음",
  unsupportedByOutputFormat: "대응 표현 없음",
};

const UNKNOWN_REASON = "원인 미상";

const UNREADABLE_REPORT =
  "변환 손실 보고서를 해석하지 못했습니다. 일부 내용이 빠졌을 수 있습니다.";

function describeLoss(code: string, count: number, reason: string): string {
  switch (code) {
    case "binaryContentEmptied":
      return `이미지 등 첨부 데이터 ${count}개를 읽지 못해 빈 내용으로 변환했습니다 (${reason}).`;
    case "controlOmitted":
      return `변환 형식에 담을 수 없는 개체 ${count}개가 빠졌습니다 (${reason}).`;
    case "metadataReduced":
      return `필드 정보 ${count}건이 일부 축소되었습니다 (${reason}).`;
    default:
      return `변환 중 일부 내용 ${count}건이 빠졌을 수 있습니다 (${reason}).`;
  }
}

interface LossKey {
  readonly code: string;
  readonly reason: string;
}

function readLosses(raw: string): Array<LossKey> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const losses = (parsed as { losses?: unknown }).losses;
  if (!Array.isArray(losses)) {
    return null;
  }
  return losses.map((loss: unknown) => {
    const record =
      typeof loss === "object" && loss !== null
        ? (loss as Record<string, unknown>)
        : {};
    const code = typeof record.code === "string" ? record.code : "";
    const reasonKey = typeof record.reason === "string" ? record.reason : "";
    const reason = Object.hasOwn(REASON_TEXT, reasonKey)
      ? REASON_TEXT[reasonKey]
      : undefined;
    return { code, reason: reason ?? UNKNOWN_REASON };
  });
}

export function contentLossToWarnings(raw: string): Array<string> {
  const losses = readLosses(raw);
  if (losses === null) {
    return [UNREADABLE_REPORT];
  }
  // 첫 등장 순서를 지키며 (code, reason) 별로 센다
  const groups = new Map<string, LossKey & { count: number }>();
  for (const { code, reason } of losses) {
    const key = `${code}\u0000${reason}`;
    const prev = groups.get(key);
    groups.set(key, { code, reason, count: (prev?.count ?? 0) + 1 });
  }
  return [...groups.values()].map(({ code, reason, count }) =>
    describeLoss(code, count, reason),
  );
}
