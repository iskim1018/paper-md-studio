import { describe, expect, it } from "vitest";
import { isHttpUrl, urlDisplayName, urlToSlug } from "../../src/lib/url-input";

describe("isHttpUrl", () => {
  it("http/https URL을 인식한다", () => {
    expect(isHttpUrl("https://example.com/post")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
  });

  it("파일 경로와 다른 스킴은 거부한다", () => {
    expect(isHttpUrl("/Users/me/문서.html")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
  });
});

describe("urlToSlug", () => {
  it("호스트와 경로를 파일명용 슬러그로 변환한다", () => {
    expect(urlToSlug("https://example.com/docs/intro/")).toBe(
      "example_com_docs_intro",
    );
  });

  it("percent-encoding된 한글 경로를 디코딩한다", () => {
    expect(
      urlToSlug(
        "https://ko.wikipedia.org/wiki/%EB%A7%88%ED%81%AC%EB%8B%A4%EC%9A%B4",
      ),
    ).toBe("ko_wikipedia_org_wiki_마크다운");
  });
});

describe("urlDisplayName", () => {
  it("프로토콜을 제거하고 경로를 디코딩한다", () => {
    expect(urlDisplayName("https://example.com/docs/intro/")).toBe(
      "example.com/docs/intro",
    );
  });
});
