import type { Reader } from "./records.js";

/**
 * BIFF8 유니코드 문자열.
 *
 * 형식: [문자 수][플래그][(서식 런 수)][(원동아시아 데이터 크기)][문자들]
 * 플래그 bit0이 0이면 한 글자가 1바이트(latin1), 1이면 2바이트(UTF-16LE)다.
 *
 * 까다로운 지점은 SST가 CONTINUE 레코드로 쪼개질 때다. 문자열이 조각 경계에
 * 걸리면 다음 조각 첫 바이트에 **인코딩 플래그가 새로 붙는다** — 같은 문자열
 * 안에서 1바이트→2바이트로 바뀔 수도 있다. 조각을 단순히 이어붙이면 이 규칙을
 * 지킬 수 없어, SST는 조각 목록을 그대로 받아 경계를 인지하며 읽는다.
 */

const decoder16 = new TextDecoder("utf-16le");
const decoder8 = new TextDecoder("latin1");

function readChars(reader: Reader, length: number, wide: boolean): string {
  const raw = reader.bytes(wide ? length * 2 : length);
  return wide ? decoder16.decode(raw) : decoder8.decode(raw);
}

/** 한 조각 안에서만 읽는 짧은 문자열 (BOUNDSHEET 시트 이름 등) */
export function readShortString(reader: Reader): string {
  const length = reader.u8();
  const flags = reader.u8();
  return readChars(reader, length, (flags & 0x01) !== 0);
}

/** 길이가 16비트인 문자열 (FORMAT 코드 등) */
export function readUnicodeString(reader: Reader): string {
  const length = reader.u16();
  const flags = reader.u8();
  const richRuns = (flags & 0x08) !== 0 ? reader.u16() : 0;
  const farEastSize = (flags & 0x04) !== 0 ? reader.u32() : 0;

  const text = readChars(reader, length, (flags & 0x01) !== 0);
  reader.skip(richRuns * 4 + farEastSize);
  return text;
}

/**
 * 조각 경계를 인지하며 읽는 커서.
 * 경계를 넘을 때마다 이어지는 문자열의 인코딩 플래그를 다시 읽는다.
 */
class ChunkCursor {
  private chunkIndex = 0;
  private offset = 0;

  constructor(private readonly chunks: ReadonlyArray<Uint8Array>) {}

  get exhausted(): boolean {
    return this.chunkIndex >= this.chunks.length;
  }

  private get chunk(): Uint8Array {
    return this.chunks[this.chunkIndex] ?? new Uint8Array(0);
  }

  /** 현재 조각을 다 썼으면 다음 조각으로 넘어간다 */
  private advanceIfNeeded(): void {
    while (
      this.chunkIndex < this.chunks.length &&
      this.offset >= this.chunk.length
    ) {
      this.chunkIndex += 1;
      this.offset = 0;
    }
  }

  skip(bytes: number): void {
    let left = bytes;
    while (left > 0) {
      this.advanceIfNeeded();
      if (this.exhausted) return;
      const take = Math.min(left, this.chunk.length - this.offset);
      this.offset += take;
      left -= take;
    }
  }

  u8(): number {
    this.advanceIfNeeded();
    if (this.exhausted) return 0;
    const value = this.chunk[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  /** 문자열 하나. 조각을 넘어가면 인코딩 플래그를 다시 읽는다. */
  readString(): string {
    const length = this.u16();
    let flags = this.u8();
    let wide = (flags & 0x01) !== 0;
    const richRuns = (flags & 0x08) !== 0 ? this.u16() : 0;
    const farEastSize = (flags & 0x04) !== 0 ? this.u32() : 0;

    const parts: Array<string> = [];
    let remaining = length;

    while (remaining > 0) {
      this.advanceIfNeeded();
      if (this.exhausted) break;

      const available = this.chunk.length - this.offset;
      const charsHere = Math.min(remaining, wide ? available >> 1 : available);

      if (charsHere <= 0) {
        // 이 조각에 온전한 글자가 안 남음 — 다음 조각의 첫 바이트가 새 플래그
        this.chunkIndex += 1;
        this.offset = 0;
        if (this.exhausted) break;
        flags = this.u8();
        wide = (flags & 0x01) !== 0;
        continue;
      }

      const byteCount = wide ? charsHere * 2 : charsHere;
      const raw = this.chunk.subarray(this.offset, this.offset + byteCount);
      parts.push(wide ? decoder16.decode(raw) : decoder8.decode(raw));
      this.offset += byteCount;
      remaining -= charsHere;

      if (remaining > 0) {
        this.chunkIndex += 1;
        this.offset = 0;
        if (this.exhausted) break;
        flags = this.u8();
        wide = (flags & 0x01) !== 0;
      }
    }

    this.skip(richRuns * 4 + farEastSize);
    return parts.join("");
  }
}

/**
 * SST(공유 문자열 테이블)를 조각 목록에서 읽는다.
 * chunks[0]은 SST 레코드 본문, 나머지는 뒤따르는 CONTINUE 본문이다.
 */
export function readSharedStrings(
  chunks: ReadonlyArray<Uint8Array>,
): Array<string> {
  const cursor = new ChunkCursor(chunks);
  cursor.skip(4); // 전체 문자열 수 (참고용)
  const uniqueCount = cursor.u32();

  const strings: Array<string> = [];
  for (let i = 0; i < uniqueCount; i += 1) {
    if (cursor.exhausted) break;
    strings.push(cursor.readString());
  }
  return strings;
}
