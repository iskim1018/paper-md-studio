import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignedUrlSigner } from "../src/auth/index.js";
import { rewriteMarkdown } from "../src/images/index.js";
import {
  LocalFsStorage,
  type StoredImageInfo,
  sha256Hex,
} from "../src/storage/index.js";

const SECRET = "test-secret-abcdefghijklmnop";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("rewriteMarkdown", () => {
  let root: string;
  let storage: LocalFsStorage;
  let conversionId: string;
  let images: ReadonlyArray<StoredImageInfo>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "paper-md-rewrite-"));
    storage = new LocalFsStorage({ root });
    const bytes = new Uint8Array([1, 2, 3]);
    conversionId = sha256Hex(bytes);
    const meta = await storage.put({
      sha256: conversionId,
      format: "hwpx",
      markdown: "ignored",
      images: [
        { name: "img_001.png", data: PNG, mimeType: "image/png" },
        { name: "img_002.png", data: PNG, mimeType: "image/png" },
      ],
      elapsed: 1,
      originalName: "x.hwpx",
      size: bytes.byteLength,
    });
    images = meta.images;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const signer = createSignedUrlSigner({ secret: SECRET, ttlSeconds: 900 });
  const sampleMd =
    "# Doc\n\n![로고](./images/img_001.png)\n\n텍스트\n\n![](./images/img_002.png)";

  it("urls 모드 + baseUrl 없음 → 경로만 반환한다", async () => {
    const result = await rewriteMarkdown({
      markdown: sampleMd,
      images,
      conversionId,
      mode: "urls",
      storage,
      signer,
      baseUrl: null,
      maxInlineKb: 512,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain(
      `/v1/conversions/${conversionId}/images/img_001.png?exp=`,
    );
    expect(result.markdown).not.toContain("./images/img_001.png");
    expect(result.responseImages[0]?.url).toMatch(/^\/v1\/conversions\//);
  });

  it("urls 모드 + baseUrl 있음 → 절대 URL", async () => {
    const result = await rewriteMarkdown({
      markdown: sampleMd,
      images,
      conversionId,
      mode: "urls",
      storage,
      signer,
      baseUrl: "https://docs.example.com",
      maxInlineKb: 512,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain(
      `https://docs.example.com/v1/conversions/${conversionId}/images/img_001.png?exp=`,
    );
    expect(result.responseImages[0]?.url).toMatch(
      /^https:\/\/docs\.example\.com\//,
    );
  });

  it("inline 모드 → data URI 로 치환, 응답에 url/uri 없음", async () => {
    const result = await rewriteMarkdown({
      markdown: sampleMd,
      images,
      conversionId,
      mode: "inline",
      storage,
      signer,
      baseUrl: null,
      maxInlineKb: 512,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain("data:image/png;base64,");
    expect(result.markdown).not.toContain("./images/");
    expect(result.responseImages[0]?.url).toBeUndefined();
    expect(result.responseImages[0]?.uri).toBeUndefined();
  });

  it("inline 모드 + 이미지가 한계 초과 → ok:false + offenders", async () => {
    const result = await rewriteMarkdown({
      markdown: sampleMd,
      images,
      conversionId,
      mode: "inline",
      storage,
      signer,
      baseUrl: null,
      // PNG 매직(8바이트) 보다 작은 한계 — 1바이트(=1024보다 작은 수치는 min(1) 로 clamp) 못 쓰니 수동 설정
      maxInlineKb: 0.001 as unknown as number,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("inline-image-too-large");
    expect(result.offenders.length).toBeGreaterThan(0);
  });

  it("refs 모드 → conv:// URI 사용, 응답 uri 필드 설정", async () => {
    const result = await rewriteMarkdown({
      markdown: sampleMd,
      images,
      conversionId,
      mode: "refs",
      storage,
      signer,
      baseUrl: null,
      maxInlineKb: 512,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain(
      `conv://${conversionId}/images/img_001.png`,
    );
    expect(result.markdown).toContain(
      `conv://${conversionId}/images/img_002.png`,
    );
    expect(result.responseImages[0]?.uri).toBe(
      `conv://${conversionId}/images/img_001.png`,
    );
    expect(result.responseImages[0]?.url).toBeUndefined();
  });

  it("omit 모드 → alt 있으면 '[이미지: alt]', 없으면 '[이미지]'", async () => {
    const result = await rewriteMarkdown({
      markdown: sampleMd,
      images,
      conversionId,
      mode: "omit",
      storage,
      signer,
      baseUrl: null,
      maxInlineKb: 512,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain("_[이미지: 로고]_");
    expect(result.markdown).toContain("_[이미지]_");
    expect(result.markdown).not.toContain("./images/");
    expect(result.markdown).not.toContain("![");
  });
});
