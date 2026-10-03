import { describe, expect, it } from "vitest";
import {
  createImageAsset,
  extFromMime,
  imageToHtml,
  makeImageName,
  mimeFromExt,
} from "../src/image-utils.js";

describe("image-utils", () => {
  describe("mimeFromExt", () => {
    it("PNG 확장자에 image/png를 반환한다", () => {
      expect(mimeFromExt("image.png")).toBe("image/png");
    });

    it("JPG 확장자에 image/jpeg를 반환한다", () => {
      expect(mimeFromExt("photo.jpg")).toBe("image/jpeg");
    });

    it("대소문자를 구분하지 않는다", () => {
      expect(mimeFromExt("IMAGE.PNG")).toBe("image/png");
    });

    it("알 수 없는 확장자에 fallback을 반환한다", () => {
      expect(mimeFromExt("file.xyz")).toBe("application/octet-stream");
    });
  });

  describe("extFromMime", () => {
    it("image/png에 .png를 반환한다", () => {
      expect(extFromMime("image/png")).toBe(".png");
    });

    it("image/jpeg에 .jpg를 반환한다", () => {
      expect(extFromMime("image/jpeg")).toBe(".jpg");
    });

    it("알 수 없는 MIME에 .bin를 반환한다", () => {
      expect(extFromMime("application/unknown")).toBe(".bin");
    });
  });

  describe("makeImageName", () => {
    it("순번에 맞는 이미지 파일명을 생성한다", () => {
      expect(makeImageName(1, ".png")).toBe("img_001.png");
      expect(makeImageName(12, ".jpg")).toBe("img_012.jpg");
      expect(makeImageName(100, "gif")).toBe("img_100.gif");
    });
  });

  describe("imageToHtml", () => {
    it("img 태그를 올바르게 생성한다", () => {
      const html = imageToHtml("doc_images", "img_001.png", "사진");
      expect(html).toBe('<img src="./doc_images/img_001.png" alt="사진">');
    });
  });

  describe("imageToHtml — alt 한 줄", () => {
    it("alt 의 줄바꿈·탭을 공백으로 바꿔 표 셀 한 줄을 깨지 않는다", () => {
      // HWPX 는 ZIP 항목 이름을 alt 로 쓴다 — 이름에 줄바꿈이 있으면 GFM 표 행이 갈라졌다
      const html = imageToHtml("doc_images", "img_001.png", "a\nb\r\nc\td");

      expect(html).toBe('<img src="./doc_images/img_001.png" alt="a b c d">');
    });
  });

  describe("imageToHtml — 속성 escape (#15)", () => {
    it("alt의 따옴표·꺾쇠·앰퍼샌드를 escape해 속성을 끊지 못하게 한다", () => {
      const html = imageToHtml(
        "doc_images",
        "img_001.png",
        'x" onerror="alert(1)<b>&',
      );

      expect(html).toBe(
        '<img src="./doc_images/img_001.png" alt="x&quot; onerror=&quot;alert(1)&lt;b&gt;&amp;">',
      );
    });

    it("이미지 폴더 이름의 따옴표도 escape한다", () => {
      const html = imageToHtml('a"b', "img_001.png", "사진");

      expect(html).toBe('<img src="./a&quot;b/img_001.png" alt="사진">');
    });
  });

  describe("createImageAsset", () => {
    it("ImageAsset 객체를 생성한다", () => {
      const data = new Uint8Array([1, 2, 3]);
      const asset = createImageAsset("img_001.png", data, "image/png");

      expect(asset.name).toBe("img_001.png");
      expect(asset.data).toBe(data);
      expect(asset.mimeType).toBe("image/png");
    });
  });
});
