import { describe, expect, it } from "vitest";
import { downloadImages } from "../src/html/download-images.js";

const PUBLIC_IP = "93.184.216.34";
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

function makeDnsStub(address = PUBLIC_IP) {
  return (async (_host: string, _options?: unknown) => [
    { address, family: 4 },
  ]) as never;
}

function makeFetchStub(contentType: string | null, status = 200): typeof fetch {
  return async () =>
    new Response(status === 200 ? PNG_BYTES : "not found", {
      status,
      headers: contentType ? { "content-type": contentType } : {},
    });
}

describe("downloadImages", () => {
  it("원격 이미지를 다운로드하고 src를 상대 경로로 치환한다", async () => {
    // Arrange
    const html =
      '<p>본문</p><img src="https://example.com/pic.png" alt="그림">';

    // Act
    const result = await downloadImages(html, "doc_images", {
      fetchImpl: makeFetchStub("image/png"),
      dnsLookup: makeDnsStub(),
    });

    // Assert
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.name).toBe("img_001.png");
    expect(result.images[0]?.mimeType).toBe("image/png");
    expect(result.html).toContain('src="./doc_images/img_001.png"');
    expect(result.html).not.toContain("https://example.com/pic.png");
  });

  it("같은 URL은 한 번만 다운로드하고 같은 파일을 참조한다", async () => {
    const html =
      '<img src="https://example.com/a.png"><img src="https://example.com/a.png">';

    const result = await downloadImages(html, "doc_images", {
      fetchImpl: makeFetchStub("image/png"),
      dnsLookup: makeDnsStub(),
    });

    expect(result.images).toHaveLength(1);
    expect(result.html.match(/\.\/doc_images\/img_001\.png/g)).toHaveLength(2);
  });

  it("다운로드 실패 시 원본 URL을 유지한다 (부분 실패 허용)", async () => {
    const html = '<img src="https://example.com/gone.png">';

    const result = await downloadImages(html, "doc_images", {
      fetchImpl: makeFetchStub("image/png", 404),
      dnsLookup: makeDnsStub(),
    });

    expect(result.images).toHaveLength(0);
    expect(result.html).toContain("https://example.com/gone.png");
  });

  it("사설 IP 이미지 URL은 차단하고 원본을 유지한다 (SSRF)", async () => {
    const html = '<img src="http://169.254.169.254/pic.png">';

    const result = await downloadImages(html, "doc_images", {
      fetchImpl: makeFetchStub("image/png"),
    });

    expect(result.images).toHaveLength(0);
    expect(result.html).toContain("169.254.169.254");
  });

  it("이미지가 아닌 content-type은 건너뛴다", async () => {
    const html = '<img src="https://example.com/page">';

    const result = await downloadImages(html, "doc_images", {
      fetchImpl: makeFetchStub("text/html"),
      dnsLookup: makeDnsStub(),
    });

    expect(result.images).toHaveLength(0);
  });

  it("content-type이 없으면 URL 확장자로 타입을 추론한다", async () => {
    const html = '<img src="https://example.com/photo.jpg">';

    const result = await downloadImages(html, "doc_images", {
      fetchImpl: makeFetchStub(null),
      dnsLookup: makeDnsStub(),
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.name).toBe("img_001.jpg");
    expect(result.images[0]?.mimeType).toBe("image/jpeg");
  });

  it("data:·상대 경로 이미지는 다운로드 대상이 아니다", async () => {
    const html =
      '<img src="data:image/png;base64,iVBOR="><img src="./local.png">';

    const result = await downloadImages(html, "doc_images", {
      fetchImpl: makeFetchStub("image/png"),
      dnsLookup: makeDnsStub(),
    });

    expect(result.images).toHaveLength(0);
    expect(result.html).toContain("data:image/png");
    expect(result.html).toContain("./local.png");
  });

  it("maxImages 한도를 초과하는 이미지는 원본 URL을 유지한다", async () => {
    const html =
      '<img src="https://example.com/1.png"><img src="https://example.com/2.png">';

    const result = await downloadImages(html, "doc_images", {
      maxImages: 1,
      fetchImpl: makeFetchStub("image/png"),
      dnsLookup: makeDnsStub(),
    });

    expect(result.images).toHaveLength(1);
    expect(result.html).toContain("https://example.com/2.png");
  });
});
