import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFsStorage, sha256Hex } from "../src/storage/index.js";

describe("LocalFsStorage", () => {
  let root: string;
  let storage: LocalFsStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "paper-md-storage-"));
    storage = new LocalFsStorage({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("put → has → getMeta → getMarkdown 사이클이 동작한다", async () => {
    const data = Buffer.from("hello world", "utf-8");
    const sha = sha256Hex(new Uint8Array(data));

    const meta = await storage.put({
      sha256: sha,
      format: "docx",
      markdown: "# Title\n\n본문",
      images: [],
      elapsed: 123,
      originalName: "sample.docx",
      size: data.byteLength,
    });

    expect(meta.conversionId).toBe(sha);
    expect(await storage.has(sha)).toBe(true);

    const loadedMeta = await storage.getMeta(sha);
    expect(loadedMeta).not.toBeNull();
    expect(loadedMeta?.format).toBe("docx");
    expect(loadedMeta?.originalName).toBe("sample.docx");
    expect(loadedMeta?.elapsed).toBe(123);

    const md = await storage.getMarkdown(sha);
    expect(md).toBe("# Title\n\n본문");
  });

  it("이미지를 저장하고 다시 읽을 수 있다", async () => {
    const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const sha = sha256Hex(fileBytes);
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    await storage.put({
      sha256: sha,
      format: "hwpx",
      markdown: "![img](./images/img_001.png)",
      images: [{ name: "img_001.png", data: pngBytes, mimeType: "image/png" }],
      elapsed: 50,
      originalName: "test.hwpx",
      size: fileBytes.byteLength,
    });

    const image = await storage.getImage(sha, "img_001.png");
    expect(image).not.toBeNull();
    expect(image?.mimeType).toBe("image/png");
    expect(Array.from(image?.data ?? [])).toEqual(Array.from(pngBytes));

    const meta = await storage.getMeta(sha);
    expect(meta?.images).toHaveLength(1);
    expect(meta?.images[0]?.name).toBe("img_001.png");
    expect(meta?.images[0]?.size).toBe(4);
  });

  it("존재하지 않는 conversionId는 null을 반환한다", async () => {
    const fakeId = "0".repeat(64);
    expect(await storage.has(fakeId)).toBe(false);
    expect(await storage.getMeta(fakeId)).toBeNull();
    expect(await storage.getMarkdown(fakeId)).toBeNull();
    expect(await storage.getImage(fakeId, "x.png")).toBeNull();
  });

  it("같은 파일을 재저장하면 같은 conversionId를 재사용한다", async () => {
    const data = new Uint8Array([10, 20, 30]);
    const sha = sha256Hex(data);

    const first = await storage.put({
      sha256: sha,
      format: "pdf",
      markdown: "첫번째",
      images: [],
      elapsed: 10,
      originalName: null,
      size: data.byteLength,
    });

    const second = await storage.put({
      sha256: sha,
      format: "pdf",
      markdown: "덮어쓴 내용",
      images: [],
      elapsed: 5,
      originalName: null,
      size: data.byteLength,
    });

    expect(first.conversionId).toBe(second.conversionId);
    const md = await storage.getMarkdown(sha);
    expect(md).toBe("덮어쓴 내용");
  });

  it("delete로 변환 결과를 제거할 수 있다", async () => {
    const data = new Uint8Array([42]);
    const sha = sha256Hex(data);

    await storage.put({
      sha256: sha,
      format: "hwp",
      markdown: "x",
      images: [],
      elapsed: 1,
      originalName: null,
      size: 1,
    });

    expect(await storage.has(sha)).toBe(true);
    await storage.delete(sha);
    expect(await storage.has(sha)).toBe(false);
  });

  it("list()는 저장된 변환 메타를 나열한다", async () => {
    const a = sha256Hex(new Uint8Array([1]));
    const b = sha256Hex(new Uint8Array([2]));

    await storage.put({
      sha256: a,
      format: "docx",
      markdown: "a",
      images: [],
      elapsed: 1,
      originalName: null,
      size: 1,
    });
    await storage.put({
      sha256: b,
      format: "pdf",
      markdown: "b",
      images: [],
      elapsed: 2,
      originalName: null,
      size: 1,
    });

    const list = await storage.list();
    const ids = list.map((m) => m.conversionId).sort();
    expect(ids).toEqual([a, b].sort());
  });

  it("빈 스토리지에서 list()는 빈 배열을 반환한다", async () => {
    const list = await storage.list();
    expect(list).toEqual([]);
  });

  it("잘못된 SHA-256 형식은 거부된다", async () => {
    await expect(
      storage.put({
        sha256: "not-a-hash",
        format: "docx",
        markdown: "x",
        images: [],
        elapsed: 0,
        originalName: null,
        size: 0,
      }),
    ).rejects.toThrow("잘못된 SHA-256 해시 형식");
  });
});
