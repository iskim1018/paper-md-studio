import { describe, expect, it } from "vitest";
import { buildFileTree, collectFileIds } from "../../src/lib/file-tree";
import type { FileItem } from "../../src/store/file-store";

function makeFile(id: string, path: string, groupDir: string | null): FileItem {
  return {
    id,
    path,
    name: path.split("/").pop() ?? path,
    format: "hwpx",
    status: "pending",
    editedMarkdown: null,
    isDirty: false,
    cleanupSnapshot: null,
    groupDir,
  };
}

describe("buildFileTree", () => {
  it("groupDir 없는 파일은 ungrouped로 분류한다", () => {
    const tree = buildFileTree([makeFile("a", "/x/a.hwpx", null)]);

    expect(tree.ungrouped).toHaveLength(1);
    expect(tree.roots).toHaveLength(0);
  });

  it("groupDir 세그먼트를 중첩 폴더 트리로 만든다", () => {
    const tree = buildFileTree([
      makeFile("a", "/root/a.hwpx", "샘플"),
      makeFile("b", "/root/sub/b.hwpx", "샘플/하위"),
      makeFile("c", "/root/sub/deep/c.hwpx", "샘플/하위/더깊이"),
    ]);

    expect(tree.roots).toHaveLength(1);
    const root = tree.roots[0];
    expect(root?.name).toBe("샘플");
    expect(root?.files.map((f) => f.id)).toEqual(["a"]);
    expect(root?.totalCount).toBe(3);

    const sub = root?.folders[0];
    expect(sub?.name).toBe("하위");
    expect(sub?.path).toBe("샘플/하위");
    expect(sub?.files.map((f) => f.id)).toEqual(["b"]);
    expect(sub?.folders[0]?.files.map((f) => f.id)).toEqual(["c"]);
  });

  it("루트 폴더가 여러 개면 이름순으로 정렬한다", () => {
    const tree = buildFileTree([
      makeFile("b", "/b/1.hwpx", "나폴더"),
      makeFile("a", "/a/1.hwpx", "가폴더"),
    ]);

    expect(tree.roots.map((r) => r.name)).toEqual(["가폴더", "나폴더"]);
  });

  it("개별 파일과 폴더 그룹이 섞여도 함께 처리한다", () => {
    const tree = buildFileTree([
      makeFile("solo", "/solo.pdf", null),
      makeFile("g1", "/root/1.hwpx", "폴더"),
    ]);

    expect(tree.ungrouped.map((f) => f.id)).toEqual(["solo"]);
    expect(tree.roots[0]?.files.map((f) => f.id)).toEqual(["g1"]);
  });
});

describe("collectFileIds", () => {
  it("하위 폴더까지 재귀적으로 모든 파일 ID를 수집한다", () => {
    const tree = buildFileTree([
      makeFile("a", "/r/a.hwpx", "루트"),
      makeFile("b", "/r/s/b.hwpx", "루트/하위"),
      makeFile("c", "/r/s/d/c.hwpx", "루트/하위/깊이"),
    ]);
    const root = tree.roots[0];

    expect(root ? collectFileIds(root).sort() : []).toEqual(["a", "b", "c"]);
  });
});
