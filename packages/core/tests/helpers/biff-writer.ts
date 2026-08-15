import CFB from "cfb";

/**
 * 테스트용 최소 BIFF8(.xls) 생성기.
 *
 * 컨테이너(OLE2)는 cfb 라이브러리, 레코드 스트림은 직접 조립한다.
 * 생성기와 파서가 둘 다 내 손으로 쓴 것이라 "서로만 맞는" 함정이 있을 수 있어,
 * 이 생성기가 만든 바이트를 독립 구현(kordoc)이 그대로 읽어내는 것을 확인해
 * 진짜 BIFF8임을 검증했다 (2026-08-16).
 */

const REC = {
  BOF: 0x0809,
  EOF: 0x000a,
  BOUNDSHEET: 0x0085,
  DATEMODE: 0x0022,
  SST: 0x00fc,
  FORMAT: 0x041e,
  XF: 0x00e0,
  ROW: 0x0208,
  COLINFO: 0x007d,
  LABELSST: 0x00fd,
  NUMBER: 0x0203,
  MERGEDCELLS: 0x00e5,
} as const;

export type XlsCell =
  | string
  | number
  | null
  | { readonly v: number; readonly xf: number };

export interface XlsSheetSpec {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<XlsCell>>;
  readonly merges?: ReadonlyArray<{
    r1: number;
    r2: number;
    c1: number;
    c2: number;
  }>;
  /** 숨긴 행 (0-based) */
  readonly hiddenRows?: ReadonlyArray<number>;
  /** 숨긴 열 (0-based) */
  readonly hiddenCols?: ReadonlyArray<number>;
  readonly hidden?: boolean;
}

export interface XlsBuildOptions {
  readonly date1904?: boolean;
  /** 사용자 정의 표시형식 */
  readonly formats?: ReadonlyArray<{ id: number; code: string }>;
  /** 셀 XF 목록 — 인덱스 16부터 순서대로 배정된다 */
  readonly xfs?: ReadonlyArray<number>;
  /** BIFF 버전 (기본 0x0600 = BIFF8) */
  readonly biffVersion?: number;
}

function rec(id: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(id, 0);
  head.writeUInt16LE(payload.length, 2);
  return Buffer.concat([head, payload]);
}

function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value, 0);
  return b;
}

function u32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0, 0);
  return b;
}

function f64(value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(value, 0);
  return b;
}

const isAscii = (text: string): boolean => {
  for (const ch of text) {
    if (ch.codePointAt(0)! > 0x7f) return false;
  }
  return true;
};

/** 16비트 길이 + 인코딩 플래그 문자열 */
function xlUnicode(text: string): Buffer {
  return isAscii(text)
    ? Buffer.concat([
        u16(text.length),
        Buffer.from([0x00]),
        Buffer.from(text, "latin1"),
      ])
    : Buffer.concat([
        u16(text.length),
        Buffer.from([0x01]),
        Buffer.from(text, "utf16le"),
      ]);
}

/** 8비트 길이 + 인코딩 플래그 문자열 (시트 이름) */
function shortUnicode(text: string): Buffer {
  return isAscii(text)
    ? Buffer.concat([
        Buffer.from([text.length, 0x00]),
        Buffer.from(text, "latin1"),
      ])
    : Buffer.concat([
        Buffer.from([text.length, 0x01]),
        Buffer.from(text, "utf16le"),
      ]);
}

function collectSharedStrings(sheets: ReadonlyArray<XlsSheetSpec>): {
  list: Array<string>;
  index: Map<string, number>;
} {
  const list: Array<string> = [];
  const index = new Map<string, number>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const cell of row) {
        if (typeof cell === "string" && cell !== "" && !index.has(cell)) {
          index.set(cell, list.length);
          list.push(cell);
        }
      }
    }
  }
  return { list, index };
}

function buildSheetStream(
  sheet: XlsSheetSpec,
  sstIndex: ReadonlyMap<string, number>,
  biffVersion: number,
): Buffer {
  const parts: Array<Buffer> = [
    rec(
      REC.BOF,
      Buffer.concat([
        u16(biffVersion),
        u16(0x0010),
        u16(0x0dbb),
        u16(0x07cc),
        u32(0),
        u32(0),
      ]),
    ),
  ];

  for (const col of sheet.hiddenCols ?? []) {
    parts.push(
      rec(
        REC.COLINFO,
        Buffer.concat([
          u16(col),
          u16(col),
          u16(2560),
          u16(15),
          u16(0x0001),
          u16(0),
        ]),
      ),
    );
  }

  sheet.rows.forEach((row, r) => {
    const hidden = (sheet.hiddenRows ?? []).includes(r);
    parts.push(
      rec(
        REC.ROW,
        Buffer.concat([
          u16(r),
          u16(0),
          u16(row.length),
          u16(255),
          u16(0),
          u16(0),
          u16(hidden ? 0x0020 : 0x0000),
          u16(15),
        ]),
      ),
    );

    row.forEach((cell, c) => {
      if (cell === null || cell === undefined || cell === "") return;
      if (typeof cell === "string") {
        parts.push(
          rec(
            REC.LABELSST,
            Buffer.concat([
              u16(r),
              u16(c),
              u16(15),
              u32(sstIndex.get(cell) ?? 0),
            ]),
          ),
        );
        return;
      }
      const value = typeof cell === "number" ? cell : cell.v;
      const xf = typeof cell === "number" ? 15 : cell.xf;
      parts.push(
        rec(REC.NUMBER, Buffer.concat([u16(r), u16(c), u16(xf), f64(value)])),
      );
    });
  });

  const merges = sheet.merges ?? [];
  if (merges.length > 0) {
    const payload: Array<Buffer> = [u16(merges.length)];
    for (const { r1, r2, c1, c2 } of merges) {
      payload.push(u16(r1), u16(r2), u16(c1), u16(c2));
    }
    parts.push(rec(REC.MERGEDCELLS, Buffer.concat(payload)));
  }

  parts.push(rec(REC.EOF, Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** 합성 .xls 바이트를 만든다 */
export function buildXls(
  sheets: ReadonlyArray<XlsSheetSpec>,
  options: XlsBuildOptions = {},
): Uint8Array {
  const {
    date1904 = false,
    formats = [],
    xfs = [],
    biffVersion = 0x0600,
  } = options;
  const sst = collectSharedStrings(sheets);

  const globalParts: Array<Buffer> = [
    rec(
      REC.BOF,
      Buffer.concat([
        u16(biffVersion),
        u16(0x0005),
        u16(0x0dbb),
        u16(0x07cc),
        u32(0),
        u32(0),
      ]),
    ),
    rec(REC.DATEMODE, u16(date1904 ? 1 : 0)),
  ];

  for (const { id, code } of formats) {
    globalParts.push(
      rec(REC.FORMAT, Buffer.concat([u16(id), xlUnicode(code)])),
    );
  }

  // 앞 16개는 스타일 XF 자리, 그 뒤가 셀 XF (인덱스 16부터)
  for (const numFmtId of [...Array(16).fill(0), ...xfs]) {
    const payload = Buffer.alloc(20);
    payload.writeUInt16LE(0, 0);
    payload.writeUInt16LE(numFmtId, 2);
    globalParts.push(rec(REC.XF, payload));
  }

  const sstPayload: Array<Buffer> = [
    u32(sst.list.length),
    u32(sst.list.length),
  ];
  for (const text of sst.list) sstPayload.push(xlUnicode(text));
  globalParts.push(rec(REC.SST, Buffer.concat(sstPayload)));

  // BOUNDSHEET는 시트 스트림 위치를 담아야 해서 전역 크기를 먼저 확정한다
  const boundsheetSize = sheets.reduce(
    (sum, s) => sum + 4 + 4 + 2 + shortUnicode(s.name).length,
    0,
  );
  const globalSize =
    globalParts.reduce((sum, b) => sum + b.length, 0) + boundsheetSize + 4;

  const sheetStreams = sheets.map((sheet) =>
    buildSheetStream(sheet, sst.index, biffVersion),
  );

  const boundsheets: Array<Buffer> = [];
  let offset = globalSize;
  sheets.forEach((sheet, i) => {
    boundsheets.push(
      rec(
        REC.BOUNDSHEET,
        Buffer.concat([
          u32(offset),
          Buffer.from([sheet.hidden ? 0x01 : 0x00, 0x00]),
          shortUnicode(sheet.name),
        ]),
      ),
    );
    offset += sheetStreams[i]?.length ?? 0;
  });

  const workbook = Buffer.concat([
    ...globalParts,
    ...boundsheets,
    rec(REC.EOF, Buffer.alloc(0)),
    ...sheetStreams,
  ]);

  const container = CFB.utils.cfb_new({ root: "R" });
  CFB.utils.cfb_add(container, "/Workbook", workbook);
  return new Uint8Array(CFB.write(container, { type: "buffer" }) as Buffer);
}
