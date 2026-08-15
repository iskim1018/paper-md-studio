import { XMLParser } from "fast-xml-parser";

/**
 * 엑셀 표시형식(numFmt) 해석.
 *
 * 엑셀은 셀에 값만 저장하고 사람이 보는 형태는 styles.xml에 따로 둔다. 해석하지
 * 않으면 날짜 2023-03-15가 시리얼 45000으로, 15.7%가 0.157로 나온다. 사람도 AI도
 * 읽을 수 없는 값이라 서식 해석은 선택이 아니라 필수다.
 */

export type FormatKind = "date" | "datetime" | "percent" | "number" | "general";

/** OOXML 내장 서식 코드 (ECMA-376 18.8.30). 로케일 의존 항목은 뺐다. */
const BUILTIN_FORMATS = new Map<number, string>([
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [11, "0.00E+00"],
  [14, "mm-dd-yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;(#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;(#,##0.00)"],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [47, "mmss.0"],
  [48, "##0.0E+0"],
  [49, "@"],
]);

/** 엑셀 1900 체계 기준일(1899-12-30)과 유닉스 epoch 사이의 일수 */
const EPOCH_OFFSET_DAYS = 25569;
/** 1904 체계(구 맥 엑셀)와 1900 체계의 차이 */
const MAC_1904_OFFSET_DAYS = 1462;
const MS_PER_DAY = 86_400_000;

/**
 * 서식 코드에서 리터럴(따옴표 문자열·대괄호 구역·백슬래시 이스케이프)을 걷어낸다.
 * `"date"#,##0`의 date를 날짜 토큰으로 오인하지 않기 위한 전처리다.
 */
function stripLiterals(code: string): string {
  return code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
}

/** 서식 코드가 여러 구역(양수;음수;0;문자)일 때 첫 구역만 쓴다 */
function firstSection(code: string): string {
  return code.split(";")[0] ?? code;
}

function formatCodeOf(
  formatId: number,
  customFormats: ReadonlyMap<number, string>,
): string | undefined {
  return customFormats.get(formatId) ?? BUILTIN_FORMATS.get(formatId);
}

/** 서식 ID를 표시 종류로 분류한다 */
export function classifyFormat(
  formatId: number,
  customFormats: ReadonlyMap<number, string>,
): FormatKind {
  const code = formatCodeOf(formatId, customFormats);
  if (code === undefined) return "general";

  const stripped = stripLiterals(code);
  if (/[ymdhs]/i.test(stripped)) {
    return /[hs]/i.test(stripped) ? "datetime" : "date";
  }
  if (stripped.includes("%")) return "percent";
  if (/[#0]/.test(stripped)) return "number";
  return "general";
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * 엑셀 날짜 시리얼을 사람이 읽는 문자열로 바꾼다.
 *
 * 엑셀은 존재하지 않는 1900-02-29를 시리얼 60으로 세는 호환 버그가 있어,
 * 60 미만 구간은 하루를 더해 보정한다.
 */
function serialToDateString(
  serial: number,
  date1904: boolean,
  withTime: boolean,
): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;

  let days = serial;
  if (date1904) days += MAC_1904_OFFSET_DAYS;
  else if (days < 60) days += 1;

  const ms = Math.round((days - EPOCH_OFFSET_DAYS) * MS_PER_DAY);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() > 9999) return null;

  const ymd = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  if (!withTime) return ymd;
  return `${ymd} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** 서식 코드의 소수 자릿수 (`0.00` → 2) */
function decimalPlaces(code: string): number {
  const section = stripLiterals(firstSection(code));
  const dot = section.indexOf(".");
  if (dot < 0) return 0;
  const after = section.slice(dot + 1);
  return (after.match(/[0#]/g) ?? []).length;
}

/** 서식 코드에 천단위 구분이 있는지 (`#,##0`) */
function hasThousandsSeparator(code: string): boolean {
  return /[#0],[#0]/.test(stripLiterals(firstSection(code)));
}

/**
 * 서식 코드의 리터럴 접두·접미를 뽑는다 (통화 기호·단위).
 * `"₩"#,##0` → prefix "₩", `#,##0"원"` → suffix "원".
 */
function literalAffixes(code: string): { prefix: string; suffix: string } {
  const section = firstSection(code);
  const numberStart = section.search(/[#0]/);
  if (numberStart < 0) return { prefix: "", suffix: "" };

  let numberEnd = numberStart;
  for (let i = section.length - 1; i >= numberStart; i -= 1) {
    if (/[#0]/.test(section[i] ?? "")) {
      numberEnd = i;
      break;
    }
  }

  const unquote = (part: string): string =>
    part
      .replace(/\[[^\]]*\]/g, "")
      .replace(/"([^"]*)"/g, "$1")
      .replace(/\\(.)/g, "$1")
      .replace(/[*_]/g, "")
      .trim();

  return {
    prefix: unquote(section.slice(0, numberStart)),
    suffix: unquote(section.slice(numberEnd + 1)),
  };
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatNumber(value: number, code: string): string {
  const decimals = decimalPlaces(code);
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart = "0", fracPart] = fixed.split(".");
  const grouped = hasThousandsSeparator(code)
    ? groupThousands(intPart)
    : intPart;
  const body = fracPart ? `${grouped}.${fracPart}` : grouped;
  const sign = value < 0 ? "-" : "";
  const { prefix, suffix } = literalAffixes(code);
  return `${sign}${prefix}${body}${suffix}`;
}

/**
 * 셀의 원시 값을 표시형식에 맞춰 사람이 읽는 문자열로 바꾼다.
 * 숫자가 아니거나 해석할 수 없으면 원본을 그대로 돌려준다 (정보 손실 금지).
 */
export function formatCellValue(
  raw: string,
  formatId: number,
  customFormats: ReadonlyMap<number, string>,
  date1904: boolean,
): string {
  const kind = classifyFormat(formatId, customFormats);
  if (kind === "general") return raw;

  const value = Number(raw);
  if (!Number.isFinite(value) || raw.trim() === "") return raw;

  if (kind === "date" || kind === "datetime") {
    return serialToDateString(value, date1904, kind === "datetime") ?? raw;
  }

  const code = formatCodeOf(formatId, customFormats);
  if (code === undefined) return raw;

  if (kind === "percent") {
    const decimals = decimalPlaces(code);
    return `${(value * 100).toFixed(decimals)}%`;
  }

  return formatNumber(value, code);
}

const stylesXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  isArray: (tagName) => ["xf", "numFmt"].includes(tagName),
});

export interface NumberFormats {
  /** cellXfs 인덱스 → numFmtId (셀의 s 속성이 이 인덱스다) */
  readonly xfFormatIds: ReadonlyArray<number>;
  /** 사용자 정의 서식 ID → 서식 코드 */
  readonly customFormats: ReadonlyMap<number, string>;
}

/** styles.xml에서 셀 스타일 인덱스 → 표시형식 정보를 뽑는다 */
export function buildNumberFormats(xml: string): NumberFormats {
  const doc = stylesXmlParser.parse(xml) as Record<string, unknown>;
  const styleSheet = (doc.styleSheet ?? {}) as Record<string, unknown>;

  const customFormats = new Map<number, string>();
  const numFmts = (styleSheet.numFmts ?? {}) as Record<string, unknown>;
  for (const entry of (numFmts.numFmt ?? []) as Array<
    Record<string, unknown>
  >) {
    const id = Number(entry["@_numFmtId"]);
    if (!Number.isInteger(id)) continue;
    customFormats.set(id, String(entry["@_formatCode"] ?? ""));
  }

  const cellXfs = (styleSheet.cellXfs ?? {}) as Record<string, unknown>;
  const xfFormatIds = (
    (cellXfs.xf ?? []) as Array<Record<string, unknown>>
  ).map((xf) => {
    const id = Number(xf["@_numFmtId"]);
    return Number.isInteger(id) ? id : 0;
  });

  return { xfFormatIds, customFormats };
}
