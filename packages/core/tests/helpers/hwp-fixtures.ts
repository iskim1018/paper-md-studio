import { createCipheriv } from "node:crypto";
import { constants, deflateRawSync } from "node:zlib";
import CFB from "cfb";
import { loadRhwp } from "../../src/parsers/hwp/rhwp-loader.js";

/**
 * .hwp 테스트 입력 생성기 — 바이너리 픽스처를 커밋하지 않고 테스트 안에서 만든다.
 *
 * HWP 5.0 본체는 rhwp 의 편집 API(`createEmpty → insertText → exportHwp`)로
 * 만든다. 생성기와 변환기가 같은 엔진이라 "서로만 맞는" 함정이 있을 수 있어,
 * 이 방식으로 만든 .hwp 를 독립 구현(Java hwp2hwpx)으로 한 번 변환해 본문이
 * 그대로 나오는 것을 로컬에서 확인했다 (2026-10-03).
 * 플래그·스트림 변형(암호·DRM·배포용·압축 폭탄)은 cfb 로 OLE2 를 직접 고친다.
 */

export const HWP5_FLAG = {
  compressed: 0x01,
  encrypted: 0x02,
  distribution: 0x04,
  drm: 0x10,
  certEncrypted: 0x100,
  certDrm: 0x400,
  trackChanges: 0x4000,
} as const;

type Container = ReturnType<typeof CFB.read>;

function readContainer(data: Uint8Array): Container {
  return CFB.read(Buffer.from(data), { type: "buffer" });
}

function writeContainer(container: Container): Uint8Array {
  return new Uint8Array(CFB.write(container, { type: "buffer" }) as Buffer);
}

function streamBytes(container: Container, path: string): Uint8Array {
  const entry = CFB.find(container, path);
  if (!entry?.content) {
    throw new Error(`스트림 없음: ${path}`);
  }
  return Uint8Array.from(entry.content as ArrayLike<number>);
}

/** 본문 한 문단짜리 HWP 5.0 (압축 플래그 켜짐) */
export async function createHwp5(text: string): Promise<Uint8Array> {
  const rhwp = await loadRhwp();
  const doc = rhwp.HwpDocument.createEmpty();
  try {
    doc.createBlankDocument();
    doc.insertText(0, 0, 0, text);
    return doc.exportHwp();
  } finally {
    doc.free();
  }
}

/** 열기 암호가 걸린 HWP 5.0 */
export async function createEncryptedHwp5(
  text: string,
  password: string,
): Promise<Uint8Array> {
  const rhwp = await loadRhwp();
  const doc = rhwp.HwpDocument.createEmpty();
  try {
    doc.createBlankDocument();
    doc.insertText(0, 0, 0, text);
    return doc.exportHwpWithPassword(password);
  } finally {
    doc.free();
  }
}

export function readHwp5Flags(data: Uint8Array): number {
  return Buffer.from(
    streamBytes(readContainer(data), "/FileHeader"),
  ).readUInt32LE(36);
}

/** FileHeader 속성 플래그(u32le @36)를 켜고 끈다 */
export function patchHwp5Flags(
  data: Uint8Array,
  set: number,
  clear = 0,
): Uint8Array {
  const container = readContainer(data);
  const header = Buffer.from(streamBytes(container, "/FileHeader"));
  header.writeUInt32LE(((header.readUInt32LE(36) | set) & ~clear) >>> 0, 36);
  return replaceStream(container, "/FileHeader", header);
}

function replaceStream(
  container: Container,
  path: string,
  content: Uint8Array,
): Uint8Array {
  const entry = CFB.find(container, path);
  if (entry) {
    entry.content = Buffer.from(content);
    entry.size = content.length;
  } else {
    CFB.utils.cfb_add(container, path, Buffer.from(content));
  }
  return writeContainer(container);
}

/** 스트림을 바꿔 넣는다 (없으면 추가) */
export function replaceHwp5Stream(
  data: Uint8Array,
  path: string,
  content: Uint8Array,
): Uint8Array {
  return replaceStream(readContainer(data), path, content);
}

/**
 * 기존 스트림 옆에 대소문자만 다른 이름의 스트림을 하나 더 넣는다 (중복 스트림
 * 공격 흉내). cfb_add 는 대소문자를 무시해 덮어쓰므로 목록에 직접 넣는다.
 */
export function appendDuplicateStream(
  data: Uint8Array,
  existingPath: string,
  duplicateName: string,
  content: Uint8Array,
): Uint8Array {
  const container = readContainer(data);
  const index = container.FullPaths.findIndex((p) => p.endsWith(existingPath));
  const entry = container.FileIndex[index];
  const fullPath = container.FullPaths[index];
  if (!entry || fullPath === undefined) {
    throw new Error(`스트림 없음: ${existingPath}`);
  }
  const name = entry.name;
  container.FileIndex.push({
    ...entry,
    name: duplicateName,
    content: Buffer.from(content),
    size: content.length,
  });
  container.FullPaths.push(
    `${fullPath.slice(0, fullPath.length - name.length)}${duplicateName}`,
  );
  return writeContainer(container);
}

/** 주어진 스트림들만 담은 OLE2 (예: FileHeader 없는 .xls 흉내) */
export function buildCfb(streams: Record<string, Uint8Array>): Uint8Array {
  const container = CFB.utils.cfb_new();
  for (const [path, content] of Object.entries(streams)) {
    CFB.utils.cfb_add(container, path, Buffer.from(content));
  }
  return writeContainer(container);
}

const MIB = 1024 * 1024;

/**
 * `megabytes` MB 의 0으로 풀리는 raw deflate 스트림 (≈1KB/MB).
 * 1MB 를 Z_SYNC_FLUSH 로 끊어 압축한 조각을 이어 붙인다 — 조각마다 사전 참조가
 * 없고 마지막 블록 표시도 없어 그대로 이어도 유효하다. 큰 버퍼를 만들지 않는다.
 */
export function deflateBomb(megabytes: number): Uint8Array {
  const segment = deflateRawSync(Buffer.alloc(MIB), {
    finishFlush: constants.Z_SYNC_FLUSH,
  });
  const finalBlock = deflateRawSync(Buffer.alloc(0));
  const parts = Array.from({ length: megabytes }, () => segment);
  return new Uint8Array(Buffer.concat([...parts, finalBlock]));
}

/**
 * RFC 1950 zlib 헤더 두 바이트. 창 크기(CINFO = windowBits - 8)가 작아도 유효한
 * 헤더다 — 첫 바이트가 0x78 이 아닐 수 있다(windowBits 13 → 0x58).
 */
export function zlibHeader(windowBits = 15): Uint8Array {
  const cmf = ((windowBits - 8) << 4) | 0x08;
  const flg = (31 - ((cmf << 8) % 31)) % 31;
  return new Uint8Array([cmf, flg]);
}

/**
 * 같은 폭탄을 zlib 헤더로 감싼 것 — rhwp 는 zlib 감싼 스트림도 푼다. 0 만 내는
 * 폭탄은 거리 1 짜리 반복이라 어떤 창 크기의 헤더를 붙여도 유효하다.
 */
export function zlibWrappedBomb(
  megabytes: number,
  windowBits = 15,
): Uint8Array {
  return new Uint8Array(
    Buffer.concat([
      zlibHeader(windowBits),
      deflateBomb(megabytes),
      Buffer.alloc(4),
    ]),
  );
}

/** 주어진 바이트의 Adler-32 (RFC 1950 꼬리) */
function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * 작은 창(windowBits)을 선언한 zlib 헤더 + **창보다 먼 거리**를 참조하는 raw
 * deflate 본문 + 올바른 Adler-32. 주기 1KB 패턴을 반복해 거리 ≈1KB(기본 창 512B
 * 밖) 역참조가 생긴다. Node 의 inflateSync 는 헤더 창을 강제해 중간에 멈추지만
 * (그래서 옛 검사는 과소평가했다), miniz(rhwp)·inflateRawSync 는 32KB 창으로
 * 끝까지 푼다. 반환 스트림은 작지만 `repeats * 1024` 바이트로 풀린다.
 */
export function farBackrefZlibStream(
  repeats: number,
  windowBits = 9,
): { stream: Uint8Array; inflatedSize: number } {
  const period = 1024;
  const unit = Buffer.alloc(period);
  for (let i = 0; i < period; i++) {
    unit[i] = (i * 7 + 3) & 0xff;
  }
  const plain = Buffer.concat(Array.from({ length: repeats }, () => unit));
  const body = deflateRawSync(plain, { level: 9 });
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(adler32(plain), 0);
  return {
    stream: new Uint8Array(Buffer.concat([zlibHeader(windowBits), body, tail])),
    inflatedSize: plain.length,
  };
}

/** MSVC rand() — 배포용 문서 키 스트림 생성기 */
function msvcRand(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    return (state >>> 16) & 0x7fff;
  };
}

/** 배포용 문서 256바이트 페이로드의 XOR 변환 (자기 역함수) */
function xorDistributionPayload(payload: Uint8Array): Uint8Array {
  const seed = Buffer.from(payload).readUInt32LE(0);
  const rand = msvcRand(seed);
  const out = Uint8Array.from(payload);
  let key = 0;
  let run = 0;
  for (let i = 0; i < 256; i++) {
    if (run === 0) {
      key = rand() & 0xff;
      run = (rand() & 0x0f) + 1;
    }
    if (i >= 4) {
      out[i] = (out[i] ?? 0) ^ key;
    }
    run--;
  }
  return out;
}

const DISTRIBUTE_DOC_DATA_TAG = 0x10 + 12;

export interface ViewTextOptions {
  /**
   * 레코드 헤더를 확장형(12비트 크기 칸 0xFFF + u32 크기 256)으로 쓴다. rhwp 는
   * 이때 암호문을 **4 + 크기** 위치에서 읽는다(`header_size = size >= 0xfff ? 8 : 4`)
   * — 실제 헤더는 8바이트라 페이로드 끝 4바이트가 암호문 앞 4바이트와 겹친다.
   * 키는 페이로드 앞쪽(최대 35번째 바이트)에 있어 겹치는 4바이트와 무관하다.
   */
  readonly extendedHeader?: boolean;
}

/**
 * 배포용 문서 ViewText 스트림을 만든다 (한글의 배포용 저장과 같은 구조):
 * DISTRIBUTE_DOC_DATA 레코드(256바이트, XOR 변환된 시드·AES 키) + AES-128-ECB 본문.
 */
export function encryptViewText(
  section: Uint8Array,
  seed = 0x1234abcd,
  options: ViewTextOptions = {},
): Uint8Array {
  const plainPayload = new Uint8Array(256).map((_, i) => (i * 37 + 11) & 0xff);
  Buffer.from(plainPayload.buffer).writeUInt32LE(seed >>> 0, 0);
  const keyOffset = 4 + ((plainPayload[0] ?? 0) & 0x0f);
  const key = plainPayload.subarray(keyOffset, keyOffset + 16);
  const padded = Buffer.alloc(Math.ceil(section.length / 16) * 16);
  padded.set(section);
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  const body = Buffer.concat([cipher.update(padded), cipher.final()]);
  const payload = xorDistributionPayload(plainPayload);
  if (options.extendedHeader) {
    const header = Buffer.alloc(8);
    header.writeUInt32LE((DISTRIBUTE_DOC_DATA_TAG | (0xfff << 20)) >>> 0, 0);
    header.writeUInt32LE(256, 4);
    return new Uint8Array(
      Buffer.concat([header, payload.subarray(0, 256 - 4), body]),
    );
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE((DISTRIBUTE_DOC_DATA_TAG | (256 << 20)) >>> 0, 0);
  return new Uint8Array(Buffer.concat([header, payload, body]));
}

/** 일반 HWP 5.0 → 배포용(본문을 ViewText 로 암호화, 플래그 0x04) */
export function toDistributionDocument(
  data: Uint8Array,
  section?: Uint8Array,
  options: ViewTextOptions = {},
): Uint8Array {
  const container = readContainer(data);
  const body = section ?? streamBytes(container, "/BodyText/Section0");
  const viewText = encryptViewText(body, undefined, options);
  const withView = replaceStream(container, "/ViewText/Section0", viewText);
  return patchHwp5Flags(withView, HWP5_FLAG.distribution);
}

/** 스트림 하나를 다른 경로로 옮긴다 (예: BodyText/Section0 → 루트 /Section0) */
export function moveHwp5Stream(
  data: Uint8Array,
  from: string,
  to: string,
): Uint8Array {
  const container = readContainer(data);
  const content = streamBytes(container, from);
  CFB.utils.cfb_del(container, from);
  CFB.utils.cfb_add(container, to, Buffer.from(content));
  return writeContainer(container);
}

/** 스트림 원본 바이트 (테스트에서 압축된 본문을 꺼낼 때) */
export function readHwp5Stream(data: Uint8Array, path: string): Uint8Array {
  return streamBytes(readContainer(data), path);
}

/** HWP 3.0 고정 헤더(30+128+1008 바이트) + 본문 */
export function buildHwp3(
  body: Uint8Array,
  options: { readonly passwordFlag?: number } = {},
): Uint8Array {
  const header = Buffer.alloc(1166);
  header.write("HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05", 0, "latin1");
  header.writeUInt16LE(options.passwordFlag ?? 0, 126);
  header[154] = 1; // 압축
  header.writeUInt16LE(0, 156); // 정보 블록 길이
  return new Uint8Array(Buffer.concat([header, body]));
}

/**
 * 병합 셀 표가 든 합성 HWPML. rhwp 는 HEAD 요소와 P/TEXT 안의 표를 요구하고
 * 버전은 2.1·2.9·2.91 만 받는다. `version: null` 이면 Version 속성을 뺀다.
 */
export function hwpmlDocument(
  options: { readonly version?: string | null; readonly head?: boolean } = {},
): string {
  const version = options.version === undefined ? "2.91" : options.version;
  const versionAttr = version === null ? "" : ` Version="${version}"`;
  const head = options.head === false ? "" : `<HEAD SecCnt="1"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<HWPML${versionAttr} SubVersion="10.0.0.0" Style="embed">${head}
  <BODY>
    <SECTION Id="0">
      <P><TEXT><CHAR>표 앞 문단</CHAR></TEXT></P>
      <P><TEXT><TABLE RowCount="2" ColCount="2"><SHAPEOBJECT TreatAsChar="true"/>
        <ROW>
          <CELL ColAddr="0" RowAddr="0" ColSpan="2" RowSpan="1"><PARALIST><P><TEXT><CHAR>병합 제목</CHAR></TEXT></P></PARALIST></CELL>
        </ROW>
        <ROW>
          <CELL ColAddr="0" RowAddr="1"><PARALIST><P><TEXT><CHAR>가</CHAR></TEXT></P></PARALIST></CELL>
          <CELL ColAddr="1" RowAddr="1"><PARALIST><P><TEXT><CHAR>나</CHAR></TEXT></P></PARALIST></CELL>
        </ROW>
      </TABLE></TEXT></P>
    </SECTION>
  </BODY>
</HWPML>`;
}
