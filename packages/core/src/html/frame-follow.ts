import { toDocument } from "./dom.js";

/**
 * 이 길이 미만의 본문 텍스트 + 프레임 존재 = "프레임 껍데기 페이지"로
 * 판정한다 (네이버 블로그 등은 본문을 iframe 안에 둔다).
 */
const MIN_SHELL_TEXT_LENGTH = 200;

/** 프레임 추적 최대 깊이 (중첩 프레임 대비) */
export const MAX_FRAME_DEPTH = 2;

/**
 * HTML이 프레임 껍데기 페이지면 본문 프레임의 절대 URL을 반환한다.
 * 껍데기가 아니거나 따라갈 수 있는 http(s) 프레임이 없으면 null.
 *
 * 판정: script/style 제외 본문 텍스트가 짧고(iframe|frame)[src]가 존재.
 * 여러 프레임 중 id/name에 "main"이 포함된 것을 우선한다
 * (예: 네이버 블로그 mainFrame).
 */
export function findMainFrameSrc(html: string, baseUrl: string): string | null {
  const document = toDocument(html);

  for (const node of document.querySelectorAll("script, style, noscript")) {
    node.remove();
  }
  const text = (document.querySelector("body")?.textContent ?? "").trim();
  if (text.length >= MIN_SHELL_TEXT_LENGTH) {
    return null;
  }

  const frames = [
    ...document.querySelectorAll("iframe[src], frame[src]"),
  ].filter((frame) => {
    const src = frame.getAttribute("src")?.trim() ?? "";
    return src.length > 0 && !/^(about:|javascript:)/i.test(src);
  });
  if (frames.length === 0) {
    return null;
  }

  const main =
    frames.find((frame) =>
      /main/i.test(
        `${frame.getAttribute("id") ?? ""} ${frame.getAttribute("name") ?? ""}`,
      ),
    ) ?? frames[0];
  const src = main?.getAttribute("src");
  if (!src) {
    return null;
  }

  try {
    const resolved = new URL(src, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}
