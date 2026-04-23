import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConvertOptions, ConvertResult } from "@paper-md-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvertCache } from "../src/cache/index.js";
import { LocalFsStorage, sha256Hex } from "../src/storage/index.js";

vi.mock("@paper-md-studio/core", async () => {
  const actual = await vi.importActual<typeof import("@paper-md-studio/core")>(
    "@paper-md-studio/core",
  );
  return {
    ...actual,
    convert: vi.fn(),
  };
});

const { convert: mockedConvert } = await import("@paper-md-studio/core");
const convertMock = vi.mocked(mockedConvert);

interface ConvertCall {
  readonly inputPath: string;
  readonly options: ConvertOptions;
}

function makeConvertResult(
  overrides: Partial<ConvertResult> = {},
): ConvertResult {
  return {
    markdown: "# Hello\n\n본문",
    images: [],
    format: "docx",
    elapsed: 42,
    ...overrides,
  };
}

describe("ConvertCache", () => {
  let storageRoot: string;
  let tmpRoot: string;
  let storage: LocalFsStorage;
  let calls: Array<ConvertCall>;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "paper-md-cache-storage-"));
    tmpRoot = await mkdtemp(join(tmpdir(), "paper-md-cache-tmp-"));
    storage = new LocalFsStorage({ root: storageRoot });
    calls = [];

    convertMock.mockReset();
    convertMock.mockImplementation(async (options: ConvertOptions) => {
      calls.push({ inputPath: options.inputPath, options });
      // tmp 파일이 실제로 존재하는지 검증하기 위해 stat 호출
      await stat(options.inputPath);
      return makeConvertResult();
    });
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("신규 변환은 MISS로 처리되고 storage에 저장된다", async () => {
    const cache = new ConvertCache({ storage, tmpDir: tmpRoot });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sha = sha256Hex(bytes);

    const result = await cache.convert({
      bytes,
      originalName: "sample.docx",
    });

    expect(result.cached).toBe(false);
    expect(result.meta.conversionId).toBe(sha);
    expect(result.meta.format).toBe("docx");
    expect(result.markdown).toBe("# Hello\n\n본문");
    expect(convertMock).toHaveBeenCalledTimes(1);
    expect(await storage.has(sha)).toBe(true);
  });

  it("같은 바이트 재요청은 HIT로 처리되고 core.convert가 호출되지 않는다", async () => {
    const cache = new ConvertCache({ storage, tmpDir: tmpRoot });
    const bytes = new Uint8Array([9, 9, 9]);
    const sha = sha256Hex(bytes);

    const first = await cache.convert({ bytes, originalName: "a.docx" });
    const second = await cache.convert({ bytes, originalName: "a.docx" });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.meta.conversionId).toBe(sha);
    expect(second.markdown).toBe(first.markdown);
    expect(convertMock).toHaveBeenCalledTimes(1);
  });

  it("같은 바이트 + 다른 originalName이어도 같은 conversionId로 HIT한다", async () => {
    const cache = new ConvertCache({ storage, tmpDir: tmpRoot });
    const bytes = new Uint8Array([7, 7]);

    const first = await cache.convert({ bytes, originalName: "alpha.docx" });
    const second = await cache.convert({ bytes, originalName: "beta.docx" });

    expect(second.cached).toBe(true);
    expect(second.meta.conversionId).toBe(first.meta.conversionId);
    expect(convertMock).toHaveBeenCalledTimes(1);
  });

  it("originalName 없이 format을 직접 지정해도 변환한다", async () => {
    convertMock.mockImplementationOnce(async (options: ConvertOptions) => {
      calls.push({ inputPath: options.inputPath, options });
      await stat(options.inputPath);
      return makeConvertResult({ format: "pdf" });
    });

    const cache = new ConvertCache({ storage, tmpDir: tmpRoot });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    const result = await cache.convert({
      bytes,
      originalName: null,
      format: "pdf",
    });

    expect(result.cached).toBe(false);
    expect(result.meta.format).toBe("pdf");
    expect(convertMock).toHaveBeenCalledTimes(1);
  });

  it("포맷 추정이 불가능하면 한국어 에러를 던진다", async () => {
    const cache = new ConvertCache({ storage, tmpDir: tmpRoot });
    const bytes = new Uint8Array([0]);

    await expect(cache.convert({ bytes, originalName: null })).rejects.toThrow(
      /포맷/,
    );
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("core.convert 실패 시 tmp 파일을 정리하고 에러를 전파한다", async () => {
    const inputPaths: Array<string> = [];
    convertMock.mockImplementationOnce(async (options: ConvertOptions) => {
      inputPaths.push(options.inputPath);
      await stat(options.inputPath);
      throw new Error("parser boom");
    });

    const cache = new ConvertCache({ storage, tmpDir: tmpRoot });
    const bytes = new Uint8Array([1]);
    const sha = sha256Hex(bytes);

    await expect(
      cache.convert({ bytes, originalName: "broken.docx" }),
    ).rejects.toThrow("parser boom");

    expect(inputPaths).toHaveLength(1);
    await expect(stat(inputPaths[0] as string)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await storage.has(sha)).toBe(false);
  });

  it("logger가 주입되면 cache.miss / cache.hit 이벤트를 기록한다", async () => {
    const events: Array<{ event: string; cached: boolean | undefined }> = [];
    const logger = {
      info: (obj: Record<string, unknown>) => {
        if (typeof obj.event === "string") {
          events.push({
            event: obj.event,
            cached: typeof obj.cached === "boolean" ? obj.cached : undefined,
          });
        }
      },
    };

    const cache = new ConvertCache({ storage, tmpDir: tmpRoot, logger });
    const bytes = new Uint8Array([5, 5, 5]);

    await cache.convert({ bytes, originalName: "a.docx" });
    await cache.convert({ bytes, originalName: "a.docx" });

    const names = events.map((e) => e.event);
    expect(names).toContain("cache.miss");
    expect(names).toContain("cache.hit");
  });
});
