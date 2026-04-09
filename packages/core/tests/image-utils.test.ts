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
