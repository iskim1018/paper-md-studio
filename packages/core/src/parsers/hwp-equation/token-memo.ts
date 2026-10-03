/**
 * 토큰 배열별 계산 결과 메모 (새로 작성 — kordoc·hml-equation-parser 에는 없다).
 *
 * 패스는 토큰 배열을 바꾸지 않고 새로 만든다. 그래서 "이 배열의 i 번째에서
 * 시작하는 항의 끝", "i 번째 `{` 의 짝" 같은 값은 (배열, 종류, i) 로 한 번만
 * 계산하면 된다. 메모가 없으면 첨자 사슬·연속 over 처럼 같은 꼬리를 거듭
 * 읽는 입력에서 변환이 O(n³) 이 됐다 (2026-10-03 실측: 9,900자 스크립트 하나에
 * 417초).
 *
 * 값은 필요할 때만 계산한다. 분수 재작성은 over 마다 새 배열을 만드는데, 그때
 * 배열 전체의 색인을 미리 만들면 over 하나에 O(n) 이 들어 연속 over 가 다시
 * O(n²) 이 된다.
 *
 * 배열 자체를 WeakMap 키로 쓰므로 배열이 버려지면 메모도 함께 수거된다.
 */
import type { EqToken } from "./tokens.js";

/** 메모 종류 — 한 배열 안에서 키는 `index * KIND_COUNT + kind` */
export const MEMO_KIND = {
  /** `(`·`[` 의 괄호 항 끝 (items.ts) */
  bracket: 0,
  /** 원자 끝 (items.ts) */
  atom: 1,
  /** 첨자 없는 항 끝 (items.ts) */
  joined: 2,
  /** 첨자·계승까지 포함한 항 끝 (items.ts) */
  item: 3,
  /** 첨자 사슬 끝 (items.ts) */
  chain: 4,
  /** `^` 인자 끝 (items.ts) */
  superscript: 5,
  /** `_` 인자 끝 (items.ts) */
  subscript: 6,
  /** `{` 의 짝 `}` (tokens.ts) */
  brace: 7,
  /** `\left` 의 짝 `\right` (left-right.ts) */
  sizer: 8,
} as const;

const KIND_COUNT = 9;

interface MemoTable {
  /** 메모를 만들 때의 길이 — 배열이 바뀌었으면 버린다 (방어) */
  readonly length: number;
  readonly values: Map<number, number>;
}

const TABLES = new WeakMap<ReadonlyArray<EqToken>, MemoTable>();

function tableOf(tokens: ReadonlyArray<EqToken>): Map<number, number> {
  const cached = TABLES.get(tokens);
  if (cached !== undefined && cached.length === tokens.length) {
    return cached.values;
  }
  const values = new Map<number, number>();
  TABLES.set(tokens, { length: tokens.length, values });
  return values;
}

export function recall(
  tokens: ReadonlyArray<EqToken>,
  kind: number,
  index: number,
): number | undefined {
  const table = TABLES.get(tokens);
  if (table === undefined || table.length !== tokens.length) return undefined;
  return table.values.get(index * KIND_COUNT + kind);
}

export function remember(
  tokens: ReadonlyArray<EqToken>,
  kind: number,
  index: number,
  value: number,
): number {
  tableOf(tokens).set(index * KIND_COUNT + kind, value);
  return value;
}
