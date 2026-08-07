/**
 * PDF 텍스트 런 전처리.
 *
 * pdf2md 는 `pageParsed` 콜백에서 페이지별 텍스트 런 배열을 넘겨준 뒤 그 배열을
 * 그대로 변환 파이프라인에 태운다. 이 모듈은 그 사이에 끼어들어 PDF 가 실제로
 * 그린 모양과 pdf2md 가 읽어내는 텍스트 사이의 간극을 메운다.
 */

/** pdf2md 가 넘겨주는 텍스트 런 (`TextItem`) 중 여기서 쓰는 필드 */
export interface PdfTextRun {
  /** 런 시작 x 좌표 (pt) */
  x: number;
  /** 런 베이스라인 y 좌표 (pt) */
  y: number;
  /** 런 너비 (pt) */
  width: number;
  /** 글자 높이 (pt) — 공백 글리프는 0일 수 있다 */
  height: number;
  /** 런의 텍스트 */
  text: string;
  /** 글꼴 식별자 */
  font: string;
}

/** 겹침 판정 허용오차 — 글자 높이 대비 비율 */
const OVERLAP_TOLERANCE_RATIO = 0.25;

/**
 * 겹침 판정 허용오차의 절대 하한 (pt).
 * 공백 글리프는 `height` 가 0이라 비율만 쓰면 허용오차가 0이 되어 중복이 남는다.
 */
const OVERLAP_TOLERANCE_MIN = 2;

/** 인접 런을 이어붙일 때 허용하는 가로 간격 (pt) */
const ADJACENT_GAP_TOLERANCE = 1;

/** 같은 줄로 볼 y 좌표 차이 (pt) */
const SAME_BASELINE_TOLERANCE = 0.5;

/**
 * 같은 글자를 미세 오프셋으로 여러 번 겹쳐 그린 런을 하나만 남깁니다.
 *
 * 한글 워드프로세서는 굵은 글씨를 굵은 글꼴 대신 **같은 텍스트를 0.1pt 씩 밀어
 * 반복해서 그리는** 방식으로 표현한다. pdf2md 는 이를 별개 런으로 읽어 전부
 * 이어붙이므로 `제안요청서` 가 23번 반복되는 식으로 망가진다.
 *
 * 텍스트와 글꼴이 같고 시작점이 글자 크기의 25% 안쪽으로 겹치는 런만 중복으로
 * 본다. 같은 글자라도 다른 줄이나 다른 칸에 있으면 그만큼 떨어져 있으므로
 * 살아남는다.
 */
export function dedupeOverlappingRuns<T extends PdfTextRun>(
  runs: ReadonlyArray<T>,
): Array<T> {
  // 텍스트·글꼴이 같은 런끼리만 비교하면 되므로 그 조합으로 묶어 탐색을 줄인다.
  // 구분자로 NUL 을 쓰는 이유는 글꼴명에도 텍스트에도 나올 수 없어 키가 겹치지 않기 때문
  const keptByKey = new Map<string, Array<T>>();
  const kept: Array<T> = [];

  for (const run of runs) {
    const key = `${run.font}\u0000${run.text}`;
    const candidates = keptByKey.get(key);

    if (candidates?.some((other) => overlaps(other, run))) {
      continue;
    }

    if (candidates) {
      candidates.push(run);
    } else {
      keptByKey.set(key, [run]);
    }
    kept.push(run);
  }

  return kept;
}

/** 두 런이 같은 자리에 겹쳐 그려졌는지 판정합니다. */
function overlaps(a: PdfTextRun, b: PdfTextRun): boolean {
  const tolerance = Math.max(
    OVERLAP_TOLERANCE_MIN,
    Math.max(a.height, b.height) * OVERLAP_TOLERANCE_RATIO,
  );
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

/**
 * 같은 줄에서 시각적 간격 없이 이어지는 런을 하나로 합칩니다.
 *
 * pdf2md 의 `LineConverter` 는 숫자와 비숫자의 경계마다 런을 끊고 다시 **공백으로**
 * 이어붙인다. 그래서 붙어 있던 `제21조` 가 `제 21 조` 로, `2천8백여종` 이
 * `2 천 8 백여종` 으로 벌어진다. 미리 하나의 런으로 합쳐두면 끊길 경계 자체가
 * 사라진다.
 *
 * 글자 크기·베이스라인이 같고 가로 간격이 1pt 이내인 런만 합친다.
 * 실제 띄어쓰기는 높이 0의 공백 런으로 들어오므로 경계 역할을 해 보존된다.
 *
 * 글꼴은 같지 않아도 된다. Chrome·Word 가 만든 PDF 는 한 문장 안의 한글과 숫자를
 * 서로 다른 글꼴에 임베드하므로(`제`=g_d0_f3 / `21`=g_d0_f2), 글꼴 일치를 요구하면
 * 정작 고치려던 `제 21 조` 가 그대로 남는다. 빈틈없이 이어지는 글자는 글꼴이
 * 달라도 눈에는 한 낱말이다.
 */
export function mergeAdjacentRuns<T extends PdfTextRun>(
  runs: ReadonlyArray<T>,
): Array<T> {
  const merged: Array<T> = [];

  for (const run of runs) {
    const previous = merged[merged.length - 1];

    if (previous && isDirectlyAdjacent(previous, run)) {
      merged[merged.length - 1] = withText(
        previous,
        previous.text + run.text,
        run.x + run.width - previous.x,
      );
      continue;
    }

    merged.push(run);
  }

  return merged;
}

/** 두 런이 같은 줄에서 빈틈없이 이어지는지 판정합니다. */
function isDirectlyAdjacent(previous: PdfTextRun, next: PdfTextRun): boolean {
  if (previous.height !== next.height) {
    return false;
  }
  if (Math.abs(previous.y - next.y) > SAME_BASELINE_TOLERANCE) {
    return false;
  }

  const gap = next.x - (previous.x + previous.width);
  return Math.abs(gap) <= ADJACENT_GAP_TOLERANCE;
}

/**
 * 텍스트와 너비만 바꾼 사본을 만듭니다.
 *
 * pdf2md 는 `TextItem` 클래스 인스턴스를 넘겨주므로 프로토타입을 유지해
 * 이후 파이프라인이 원본과 동일하게 다룰 수 있게 한다.
 */
function withText<T extends PdfTextRun>(
  run: T,
  text: string,
  width: number,
): T {
  return Object.assign(
    Object.create(Object.getPrototypeOf(run) as object) as T,
    run,
    {
      text,
      width,
    },
  );
}
