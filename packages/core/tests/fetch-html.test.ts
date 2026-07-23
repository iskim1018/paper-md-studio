import { describe, expect, it } from "vitest";
import { fetchHtml } from "../src/html/fetch-html.js";

const PUBLIC_IP = "93.184.216.34";

function makeDnsStub(address: string) {
  return (async (_host: string, _options?: unknown) => [
    { address, family: 4 },
  ]) as never;
}

function makeFetchStub(
  body: string | Uint8Array,
  contentType: string,
): typeof fetch {
  return async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": contentType },
    });
}

describe("fetchHtml", () => {
  it("원격 HTML을 가져와 디코딩한다", async () => {
    // Arrange
    const fetchImpl = makeFetchStub(
      "<html><body><p>원격 본문</p></body></html>",
      "text/html; charset=utf-8",
    );

    // Act
    const result = await fetchHtml("https://example.com/post", {
      fetchImpl,
      dnsLookup: makeDnsStub(PUBLIC_IP),
    });

    // Assert
    expect(result.html).toContain("원격 본문");
    expect(result.finalUrl).toBe("https://example.com/post");
  });

  it("charset=euc-kr 응답을 올바르게 디코딩한다", async () => {
    // "한글" 의 EUC-KR 바이트
    const body = Uint8Array.from([0xc7, 0xd1, 0xb1, 0xdb]);
    const fetchImpl = makeFetchStub(body, "text/html; charset=euc-kr");

    const result = await fetchHtml("https://example.com/kr", {
      fetchImpl,
      dnsLookup: makeDnsStub(PUBLIC_IP),
    });

    expect(result.html).toContain("한글");
  });

  it("사설 IP 대역 URL은 차단한다 (SSRF)", async () => {
    await expect(
      fetchHtml("http://127.0.0.1/admin", {
        fetchImpl: makeFetchStub("x", "text/html"),
      }),
    ).rejects.toThrow("URL을 가져오지 못했습니다");

    await expect(
      fetchHtml("http://169.254.169.254/latest/meta-data", {
        fetchImpl: makeFetchStub("x", "text/html"),
      }),
    ).rejects.toThrow("URL을 가져오지 못했습니다");
  });

  it("사설 IP로 해석되는 호스트를 차단한다", async () => {
    await expect(
      fetchHtml("https://internal.example.com/", {
        fetchImpl: makeFetchStub("x", "text/html"),
        dnsLookup: makeDnsStub("192.168.0.10"),
      }),
    ).rejects.toThrow("URL을 가져오지 못했습니다");
  });

  it("HTML이 아닌 content-type은 거부한다", async () => {
    const fetchImpl = makeFetchStub("%PDF-1.7", "application/pdf");

    await expect(
      fetchHtml("https://example.com/file.pdf", {
        fetchImpl,
        dnsLookup: makeDnsStub(PUBLIC_IP),
      }),
    ).rejects.toThrow("HTML 문서가 아닙니다");
  });
});
