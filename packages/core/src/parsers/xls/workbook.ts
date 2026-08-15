import type { NumberFormats } from "../spreadsheet/cell-format.js";
import type { BiffRecord } from "./records.js";
import { REC, Reader, readRecords } from "./records.js";
import {
  readSharedStrings,
  readShortString,
  readUnicodeString,
} from "./strings.js";

/**
 * 워크북 전역 영역(첫 BOF~EOF) 해석.
 *
 * 여기서 시트 목록·공유 문자열·표시형식이 나온다. XLSX의 workbook.xml +
 * sharedStrings.xml + styles.xml에 해당하는 정보가 한 스트림에 섞여 있다.
 */

export interface XlsSheetRef {
  readonly name: string;
  /** 이 시트의 레코드가 시작하는 스트림 위치 */
  readonly streamOffset: number;
  /** 숨김·매우숨김 여부 */
  readonly hidden: boolean;
}

export interface XlsGlobals {
  readonly sheets: ReadonlyArray<XlsSheetRef>;
  readonly sharedStrings: ReadonlyArray<string>;
  readonly formats: NumberFormats;
  readonly date1904: boolean;
}

/** BOUNDSHEET: 시트 위치·이름·표시 상태 */
function parseBoundSheet(data: Uint8Array): XlsSheetRef {
  const reader = new Reader(data);
  const streamOffset = reader.u32();
  const state = reader.u8() & 0x03; // 0=보임, 1=숨김, 2=매우숨김
  reader.u8(); // 시트 종류 (워크시트/차트 등)
  return {
    name: readShortString(reader),
    streamOffset,
    hidden: state !== 0,
  };
}

export function parseGlobals(stream: Uint8Array): XlsGlobals {
  const sheets: Array<XlsSheetRef> = [];
  const customFormats = new Map<number, string>();
  const xfFormatIds: Array<number> = [];
  let date1904 = false;

  /** SST 본문 + 뒤따르는 CONTINUE 본문 */
  let sstChunks: Array<Uint8Array> | null = null;
  let sharedStrings: Array<string> = [];

  const finishSst = (): void => {
    if (!sstChunks) return;
    sharedStrings = readSharedStrings(sstChunks);
    sstChunks = null;
  };

  for (const record of readRecords(stream)) {
    // SST 뒤에 붙는 CONTINUE는 문자열의 일부다
    if (sstChunks && record.id === REC.CONTINUE) {
      sstChunks.push(record.data);
      continue;
    }
    finishSst();

    switch (record.id) {
      case REC.BOUNDSHEET:
        sheets.push(parseBoundSheet(record.data));
        break;
      case REC.DATEMODE:
        date1904 = new Reader(record.data).u16() === 1;
        break;
      case REC.FORMAT: {
        const reader = new Reader(record.data);
        const id = reader.u16();
        customFormats.set(id, readUnicodeString(reader));
        break;
      }
      case REC.XF: {
        const reader = new Reader(record.data);
        reader.u16(); // 글꼴
        xfFormatIds.push(reader.u16());
        break;
      }
      case REC.SST:
        sstChunks = [record.data];
        break;
      case REC.EOF:
        // 전역 영역 끝 — 이후는 시트별 스트림
        finishSst();
        return {
          sheets,
          sharedStrings,
          formats: { xfFormatIds, customFormats },
          date1904,
        };
      default:
        break;
    }
  }

  finishSst();
  return {
    sheets,
    sharedStrings,
    formats: { xfFormatIds, customFormats },
    date1904,
  };
}

/** BIFF8인지 확인하고, 아니면 사용자가 취할 행동이 있는 메시지를 남긴다 */
export function assertSupportedBiff(stream: Uint8Array): void {
  const first: BiffRecord | undefined = readRecords(stream).next().value;
  if (!first || first.id !== REC.BOF) {
    throw new Error(
      "올바른 XLS 파일이 아닙니다 (BIFF 레코드를 찾을 수 없습니다).",
    );
  }
  const version = new Reader(first.data).u16();
  // 0x0600 = BIFF8 (Excel 97 이후). 그 이전 판은 레코드 구조가 달라 못 읽는다.
  if (version !== 0x0600) {
    throw new Error(
      `지원하지 않는 XLS 판입니다 (BIFF 버전 0x${version.toString(16)}). ` +
        "Excel에서 열어 다시 저장하거나 .xlsx로 변환해주세요.",
    );
  }
}
