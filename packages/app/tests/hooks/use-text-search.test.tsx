// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTextSearch } from "../../src/hooks/use-text-search";

/** CSS Custom Highlight API 대역 — jsdom 에는 없다 */
class FakeHighlight extends Set<Range> {
  priority = 0;
}

let registry: Map<string, FakeHighlight>;

function ranges(name: string): Array<string> {
  return [...(registry.get(name) ?? [])].map((range) => range.toString());
}

function container(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

beforeEach(() => {
  registry = new Map();
  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal("Highlight", FakeHighlight);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useTextSearch — Highlight API", () => {
  it("DOM 을 감싸지 않고 매치를 Range 로 표시한다", () => {
    const root = container("<p>사과 배 사과</p>");
    const { result } = renderHook(() =>
      useTextSearch({ containerRef: { current: root } }),
    );

    act(() => result.current.setQuery("사과"));

    expect(result.current.matches).toBe(2);
    expect(ranges("text-search-match")).toEqual(["사과", "사과"]);
    expect(ranges("text-search-match-active")).toEqual(["사과"]);
    expect(root.querySelector("span")).toBeNull();
  });

  it("두 패널이 동시에 검색해도 서로의 하이라이트를 지우지 않는다", () => {
    const left = container("<p>왼쪽 낱말</p>");
    const right = container("<p>오른쪽 낱말</p>");
    const a = renderHook(() =>
      useTextSearch({ containerRef: { current: left } }),
    );
    const b = renderHook(() =>
      useTextSearch({ containerRef: { current: right } }),
    );

    act(() => a.result.current.setQuery("낱말"));
    act(() => b.result.current.setQuery("낱말"));
    expect(ranges("text-search-match")).toHaveLength(2);

    act(() => a.result.current.clear());
    expect(ranges("text-search-match")).toHaveLength(1);
    const [remaining] = [...(registry.get("text-search-match") ?? [])];
    expect(right.contains(remaining?.startContainer ?? null)).toBe(true);
  });

  it("같은 매치 수로 다시 검색해도(내용 갱신) 활성 표시가 남는다", () => {
    const root = container("<p>하나 하나</p>");
    const { result, rerender } = renderHook(
      ({ key }) =>
        useTextSearch({ containerRef: { current: root }, resetKey: key }),
      { initialProps: { key: 1 } },
    );
    act(() => result.current.setQuery("하나"));
    act(() => result.current.next());

    root.innerHTML = "<p>하나 하나</p>";
    rerender({ key: 2 });

    expect(result.current.activeIndex).toBe(1);
    expect(ranges("text-search-match-active")).toHaveLength(1);
  });

  it("언마운트하면 자기 하이라이트를 지운다", () => {
    const root = container("<p>지울 낱말</p>");
    const { result, unmount } = renderHook(() =>
      useTextSearch({ containerRef: { current: root } }),
    );
    act(() => result.current.setQuery("낱말"));

    unmount();

    expect(ranges("text-search-match")).toEqual([]);
    expect(ranges("text-search-match-active")).toEqual([]);
  });
});
