import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convert } from "../src/pipeline.js";

const TEMP_DIR = resolve(import.meta.dirname, ".tmp-image-test");

function createHwpxWithImage(): Uint8Array {
  // 1x1 red pixel PNG
  const pngData = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  const headerXml = `<?xml version="1.0" encoding="UTF-8"?>
<head>
  <refList>
    <styles>
      <style id="0" name="본문" />
    </styles>
    <charProperties>
      <charPr id="0" />
    </charProperties>
  </refList>
</head>`;

  const sectionXml = `<?xml version="1.0" encoding="UTF-8"?>
<sec>
  <p styleIDRef="0">
    <run><t>이미지 포함 문서</t></run>
  </p>
  <p styleIDRef="0">
    <run>
      <img binaryItemIDRef="test_image.png" />
    </run>
  </p>
  <p styleIDRef="0">
    <run><t>이미지 후 텍스트</t></run>
  </p>
</sec>`;

  const hpfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package>
  <manifest>
    <item id="section0" href="section0.xml" />
  </manifest>
  <spine>
    <itemref idref="section0" />
  </spine>
</package>`;

  return zipSync({
    mimetype: strToU8("application/hwpx+zip"),
    "Contents/header.xml": strToU8(headerXml),
    "Contents/section0.xml": strToU8(sectionXml),
    "Contents/content.hpf": strToU8(hpfXml),
    "BinData/test_image.png": pngData,
  });
}

describe("이미지 추출", () => {
  beforeAll(() => {
    mkdirSync(TEMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  describe("HWPX 이미지 추출", () => {
    it("ZIP 내 이미지를 추출하고 MD에 참조를 삽입한다", async () => {
      const hwpxPath = join(TEMP_DIR, "with-image.hwpx");
      writeFileSync(hwpxPath, createHwpxWithImage());

      const result = await convert({ inputPath: hwpxPath });

      // 이미지 추출 확인
      expect(result.images).toHaveLength(1);
      expect(result.images[0].name).toBe("img_001.png");
      expect(result.images[0].mimeType).toBe("image/png");
      expect(result.images[0].data.length).toBeGreaterThan(0);

      // MD 내 이미지 참조 확인
      expect(result.markdown).toContain("with-image_images");
      expect(result.markdown).toContain("img_001.png");
    });

    it("실제 HWPX 파일의 images 필드는 배열 형태로 반환된다", async () => {
      const result = await convert({
        inputPath: resolve(import.meta.dirname, "fixtures/sample.hwpx"),
      });

      expect(Array.isArray(result.images)).toBe(true);
      for (const img of result.images) {
        expect(img.name).toMatch(/^img_\d{3}\.[a-z]+$/);
        expect(img.mimeType).toMatch(/^image\//);
        expect(img.data.length).toBeGreaterThan(0);
      }
    });

    it("커스텀 imagesDirName이 MD에 반영된다", async () => {
      const hwpxPath = join(TEMP_DIR, "custom-dir.hwpx");
      writeFileSync(hwpxPath, createHwpxWithImage());

      const result = await convert({
        inputPath: hwpxPath,
        imagesDirName: "assets",
      });

      expect(result.markdown).toContain("./assets/img_001.png");
    });
  });

  describe("DOCX 이미지 추출", () => {
    it("DOCX 내 이미지를 추출하고 MD에 참조를 삽입한다", async () => {
      const result = await convert({
        inputPath: resolve(
          import.meta.dirname,
          "fixtures/sample-with-image.docx",
        ),
      });

      expect(result.images).toHaveLength(1);
      expect(result.images[0].name).toBe("img_001.png");
      expect(result.images[0].mimeType).toBe("image/png");
      expect(result.images[0].data.length).toBeGreaterThan(0);

      // MD 내 이미지 참조 확인
      expect(result.markdown).toContain("img_001.png");
    });

    it("이미지가 없는 DOCX는 빈 이미지 배열을 반환한다", async () => {
      const result = await convert({
        inputPath: resolve(import.meta.dirname, "fixtures/sample.docx"),
      });

      expect(result.images).toHaveLength(0);
    });
  });

  describe("PDF 이미지 추출", () => {
    it("PDF는 이미지 추출을 지원하지 않으므로 빈 배열을 반환한다", async () => {
      const result = await convert({
        inputPath: resolve(import.meta.dirname, "fixtures/sample.pdf"),
      });

      expect(result.images).toHaveLength(0);
    });
  });
});
