import { describe, expect, it } from "vitest";
import { isHttpUrl } from "../src/html/is-url.js";
import { urlToSlug } from "../src/html/url-slug.js";

describe("isHttpUrl", () => {
  it("http/https URL을 인식한다", () => {
    expect(isHttpUrl("https://example.com/post")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("파일 경로와 다른 스킴은 거부한다", () => {
    expect(isHttpUrl("/Users/me/문서.html")).toBe(false);
    expect(isHttpUrl("./relative/path.html")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("example.com/post")).toBe(false);
  });
});

describe("urlToSlug", () => {
  it("호스트와 경로를 파일명용 슬러그로 변환한다", () => {
    expect(urlToSlug("https://example.com/docs/intro/")).toBe(
      "example_com_docs_intro",
    );
  });

  it("경로가 없으면 호스트만 사용한다", () => {
    expect(urlToSlug("https://example.com/")).toBe("example_com");
  });

  it("percent-encoding된 한글 경로를 디코딩한다", () => {
    expect(
      urlToSlug(
        "https://ko.wikipedia.org/wiki/%EB%A7%88%ED%81%AC%EB%8B%A4%EC%9A%B4",
      ),
    ).toBe("ko_wikipedia_org_wiki_마크다운");
  });

  it("잘못된 URL은 기본값을 반환한다", () => {
    expect(urlToSlug("not a url")).toBe("page");
  });
});
