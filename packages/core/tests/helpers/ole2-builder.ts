/**
 * 의존성 없는 적대적 OLE2(복합 문서) 생성기 — 검증기 테스트 전용.
 *
 * `cfb` 로는 만들 수 없는 망가진 구조(FAT·DIFAT·디렉터리 순환, 중간 체인을
 * 가리키는 항목, 파일 밖 시작 섹터)를 바이트 단위로 조립한다. [MS-CFB] 2.2.
 */

export const FREESECT = -1;
export const ENDOFCHAIN = -2;
export const FATSECT = -3;

export interface Ole2Entry {
  readonly name?: string;
  /** 0=미사용, 1=스토리지, 2=스트림, 5=루트 */
  readonly type?: number;
  readonly left?: number;
  readonly right?: number;
  readonly child?: number;
  readonly start?: number;
  readonly size?: number;
}

export interface Ole2Spec {
  /** cfb 의 sectors 길이 = 총 섹터 수 (헤더 섹터 제외) */
  readonly sectorCount: number;
  /** FAT 를 담는 섹터 번호들 */
  readonly fatSectors: ReadonlyArray<number>;
  /** 섹터 번호 → 다음 섹터 (FAT 항목). 생략 시 FREESECT */
  readonly fat: ReadonlyArray<number>;
  readonly dirStart: number;
  readonly entries: ReadonlyArray<Ole2Entry>;
  readonly difatStart?: number;
  readonly difatCount?: number;
  /** 헤더 109칸에 넣을 DIFAT (생략 시 fatSectors) */
  readonly headerDifat?: ReadonlyArray<number>;
}

const SSZ = 512;

function writeEntry(sector: Buffer, off: number, entry: Ole2Entry): void {
  sector.fill(0, off, off + 128);
  const name = entry.name ?? "";
  sector.write(name, off, "utf16le");
  sector.writeUInt16LE(name.length ? (name.length + 1) * 2 : 0, off + 64);
  sector[off + 66] = entry.type ?? 0;
  sector[off + 67] = 1;
  sector.writeInt32LE(entry.left ?? -1, off + 68);
  sector.writeInt32LE(entry.right ?? -1, off + 72);
  sector.writeInt32LE(entry.child ?? -1, off + 76);
  sector.writeInt32LE(entry.start ?? ENDOFCHAIN, off + 116);
  sector.writeUInt32LE((entry.size ?? 0) >>> 0, off + 120);
}

function writeHeader(buf: Buffer, spec: Ole2Spec): void {
  buf.write("d0cf11e0a1b11ae1", 0, "hex");
  buf.writeUInt16LE(0x3e, 24);
  buf.writeUInt16LE(3, 26);
  buf.writeUInt16LE(0xfffe, 28);
  buf.writeUInt16LE(9, 30);
  buf.writeUInt16LE(6, 32);
  buf.writeInt32LE(0, 40);
  buf.writeInt32LE(spec.fatSectors.length, 44);
  buf.writeInt32LE(spec.dirStart, 48);
  buf.writeInt32LE(0, 52);
  buf.writeInt32LE(4096, 56);
  buf.writeInt32LE(ENDOFCHAIN, 60);
  buf.writeInt32LE(0, 64);
  buf.writeInt32LE(spec.difatStart ?? ENDOFCHAIN, 68);
  buf.writeInt32LE(spec.difatCount ?? 0, 72);
  const headerDifat = spec.headerDifat ?? spec.fatSectors;
  for (let i = 0; i < 109; i++) {
    buf.writeInt32LE(
      i < headerDifat.length ? headerDifat[i] : FREESECT,
      76 + i * 4,
    );
  }
}

function writeFat(spec: Ole2Spec, sector: (index: number) => Buffer): void {
  for (let i = 0; i < spec.fatSectors.length * 128; i++) {
    const host = spec.fatSectors[Math.floor(i / 128)];
    if (host === undefined) {
      continue;
    }
    sector(host).writeInt32LE(
      (i < spec.fat.length ? spec.fat[i] : FREESECT) ?? FREESECT,
      (i % 128) * 4,
    );
  }
}

function writeDirectory(
  spec: Ole2Spec,
  sector: (index: number) => Buffer,
): void {
  let j = spec.dirStart;
  let k = 0;
  const seen = new Set<number>();
  while (
    j >= 0 &&
    j < spec.sectorCount &&
    k < spec.entries.length &&
    !seen.has(j)
  ) {
    seen.add(j);
    for (let e = 0; e < 4 && k < spec.entries.length; e++, k++) {
      const entry = spec.entries[k];
      if (entry) {
        writeEntry(sector(j), e * 128, entry);
      }
    }
    j = spec.fat[j] ?? ENDOFCHAIN;
  }
}

/** 적대적 OLE2(v3, 섹터 512) 바이트를 조립한다 */
export function buildOle2(spec: Ole2Spec): Uint8Array {
  const buf = Buffer.alloc(SSZ * (spec.sectorCount + 1));
  const sector = (index: number): Buffer =>
    buf.subarray((index + 1) * SSZ, (index + 2) * SSZ);
  writeHeader(buf, spec);
  writeFat(spec, sector);
  writeDirectory(spec, sector);
  return new Uint8Array(buf);
}

/** 루트 항목(type 5) — 대부분의 스펙 첫 항목 */
export function rootEntry(child = -1): Ole2Entry {
  return { name: "Root Entry", type: 5, child, start: ENDOFCHAIN, size: 0 };
}
