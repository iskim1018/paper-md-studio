/**
 * BIFF 레코드 스트림 읽기.
 *
 * .xls는 OLE2(복합 문서) 안의 "Workbook" 스트림에 레코드를 죽 늘어놓은 형태다.
 * 레코드는 [ID 2바이트][길이 2바이트][내용]이고, 8224바이트를 넘는 내용은
 * CONTINUE 레코드로 쪼개진다.
 */

/** 관심 있는 레코드 ID (MS-XLS 사양) */
export const REC = {
  FORMULA: 0x0006,
  EOF: 0x000a,
  DATEMODE: 0x0022,
  CONTINUE: 0x003c,
  COLINFO: 0x007d,
  BOUNDSHEET: 0x0085,
  MULRK: 0x00bd,
  MULBLANK: 0x00be,
  XF: 0x00e0,
  MERGEDCELLS: 0x00e5,
  SST: 0x00fc,
  LABELSST: 0x00fd,
  BLANK: 0x0201,
  NUMBER: 0x0203,
  LABEL: 0x0204,
  BOOLERR: 0x0205,
  STRING: 0x0207,
  ROW: 0x0208,
  RK: 0x027e,
  FORMAT: 0x041e,
  BOF: 0x0809,
} as const;

export interface BiffRecord {
  readonly id: number;
  readonly data: Uint8Array;
  /** 스트림에서 이 레코드가 시작한 바이트 위치 */
  readonly offset: number;
}

/** 레코드를 차례로 읽는다 (CONTINUE 병합은 호출측 판단) */
export function* readRecords(stream: Uint8Array): Generator<BiffRecord> {
  let pos = 0;
  while (pos + 4 <= stream.length) {
    const id = (stream[pos] ?? 0) | ((stream[pos + 1] ?? 0) << 8);
    const size = (stream[pos + 2] ?? 0) | ((stream[pos + 3] ?? 0) << 8);
    const start = pos + 4;
    const end = Math.min(start + size, stream.length);
    yield { id, data: stream.subarray(start, end), offset: pos };
    pos = end;
    // 손상된 스트림에서 제자리 맴돌지 않도록
    if (end <= start && size === 0 && id === 0) break;
  }
}

/** 리틀엔디언 읽기 도우미 */
export class Reader {
  private pos = 0;

  constructor(private readonly data: Uint8Array) {}

  get position(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }

  seek(pos: number): void {
    this.pos = pos;
  }

  skip(bytes: number): void {
    this.pos += bytes;
  }

  u8(): number {
    const value = this.data[this.pos] ?? 0;
    this.pos += 1;
    return value;
  }

  u16(): number {
    const value =
      (this.data[this.pos] ?? 0) | ((this.data[this.pos + 1] ?? 0) << 8);
    this.pos += 2;
    return value;
  }

  i32(): number {
    const view = new DataView(
      this.data.buffer,
      this.data.byteOffset + this.pos,
      4,
    );
    this.pos += 4;
    return view.getInt32(0, true);
  }

  u32(): number {
    return this.i32() >>> 0;
  }

  f64(): number {
    const view = new DataView(
      this.data.buffer,
      this.data.byteOffset + this.pos,
      8,
    );
    this.pos += 8;
    return view.getFloat64(0, true);
  }

  bytes(length: number): Uint8Array {
    const slice = this.data.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }
}

/**
 * RK 값 디코딩 — 엑셀이 자주 쓰는 30비트 압축 실수.
 * 하위 2비트가 "100으로 나눌지"와 "정수인지"를 가리킨다.
 */
export function decodeRk(rk: number): number {
  const isMultiplied = (rk & 0x01) !== 0;
  const isInteger = (rk & 0x02) !== 0;

  let value: number;
  if (isInteger) {
    value = rk >> 2;
  } else {
    // 상위 30비트가 IEEE754 double의 상위 비트, 나머지는 0
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(4, rk & 0xfffffffc, false);
    value = view.getFloat64(0, false);
  }
  return isMultiplied ? value / 100 : value;
}
