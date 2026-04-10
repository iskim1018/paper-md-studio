import { beforeEach, describe, expect, it } from "vitest";
import { isSupportedFile, useFileStore } from "../src/store/file-store";

describe("isSupportedFile", () => {
  it("HWPX 파일을 허용한다", () => {
    expect(isSupportedFile("/path/to/문서.hwpx")).toBe(true);
  });

  it("DOCX 파일을 허용한다", () => {
    expect(isSupportedFile("/path/to/report.docx")).toBe(true);
  });

  it("PDF 파일을 허용한다", () => {
    expect(isSupportedFile("/Users/test/file.pdf")).toBe(true);
  });

  it("대문자 확장자도 허용한다", () => {
    expect(isSupportedFile("/path/to/FILE.HWPX")).toBe(true);
    expect(isSupportedFile("/path/to/FILE.DOCX")).toBe(true);
    expect(isSupportedFile("/path/to/FILE.PDF")).toBe(true);
  });

  it("지원하지 않는 형식은 거부한다", () => {
    expect(isSupportedFile("/path/to/image.png")).toBe(false);
    expect(isSupportedFile("/path/to/text.txt")).toBe(false);
    expect(isSupportedFile("/path/to/doc.hwp")).toBe(false);
    expect(isSupportedFile("/path/to/old.doc")).toBe(false);
  });

  it("확장자가 없는 파일은 거부한다", () => {
    expect(isSupportedFile("/path/to/noextension")).toBe(false);
  });
});

describe("useFileStore", () => {
  beforeEach(() => {
    // 스토어를 초기 상태로 리셋
    useFileStore.setState({ files: [], selectedFileId: null });
  });

  describe("addFiles", () => {
    it("지원하는 파일을 추가한다", () => {
      useFileStore.getState().addFiles(["/path/to/doc.hwpx"]);

      const { files } = useFileStore.getState();
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe("doc.hwpx");
      expect(files[0].path).toBe("/path/to/doc.hwpx");
      expect(files[0].format).toBe("hwpx");
      expect(files[0].status).toBe("pending");
    });

    it("여러 파일을 한번에 추가한다", () => {
      useFileStore
        .getState()
        .addFiles(["/path/to/a.hwpx", "/path/to/b.docx", "/path/to/c.pdf"]);

      const { files } = useFileStore.getState();
      expect(files).toHaveLength(3);
      expect(files[0].format).toBe("hwpx");
      expect(files[1].format).toBe("docx");
      expect(files[2].format).toBe("pdf");
    });

    it("지원하지 않는 파일은 필터링한다", () => {
      useFileStore
        .getState()
        .addFiles(["/path/to/a.hwpx", "/path/to/b.png", "/path/to/c.txt"]);

      const { files } = useFileStore.getState();
      expect(files).toHaveLength(1);
      expect(files[0].format).toBe("hwpx");
    });

    it("모두 지원하지 않는 파일이면 추가하지 않는다", () => {
      useFileStore.getState().addFiles(["/path/to/a.png", "/path/to/b.txt"]);

      const { files } = useFileStore.getState();
      expect(files).toHaveLength(0);
    });

    it("첫 파일 추가 시 자동 선택한다", () => {
      useFileStore.getState().addFiles(["/path/to/doc.hwpx"]);

      const { selectedFileId, files } = useFileStore.getState();
      expect(selectedFileId).toBe(files[0].id);
    });

    it("이미 선택된 파일이 있으면 선택을 변경하지 않는다", () => {
      useFileStore.getState().addFiles(["/path/to/a.hwpx"]);
      const firstId = useFileStore.getState().files[0].id;

      useFileStore.getState().addFiles(["/path/to/b.docx"]);

      expect(useFileStore.getState().selectedFileId).toBe(firstId);
    });

    it("이미 등록된 경로는 중복 추가하지 않는다", () => {
      useFileStore.getState().addFiles(["/path/to/doc.hwpx"]);
      useFileStore.getState().addFiles(["/path/to/doc.hwpx"]);

      const { files } = useFileStore.getState();
      expect(files).toHaveLength(1);
    });

    it("같은 배열 내 중복 경로도 하나만 추가한다", () => {
      useFileStore
        .getState()
        .addFiles(["/path/to/doc.hwpx", "/path/to/doc.hwpx"]);

      const { files } = useFileStore.getState();
      expect(files).toHaveLength(1);
    });

    it("고유한 ID를 부여한다", () => {
      useFileStore.getState().addFiles(["/path/to/a.hwpx", "/path/to/b.hwpx"]);

      const { files } = useFileStore.getState();
      expect(files[0].id).not.toBe(files[1].id);
    });
  });

  describe("selectFile", () => {
    it("파일을 선택한다", () => {
      useFileStore.getState().addFiles(["/path/to/a.hwpx", "/path/to/b.docx"]);
      const secondId = useFileStore.getState().files[1].id;

      useFileStore.getState().selectFile(secondId);

      expect(useFileStore.getState().selectedFileId).toBe(secondId);
    });

    it("null로 선택 해제한다", () => {
      useFileStore.getState().addFiles(["/path/to/a.hwpx"]);
      useFileStore.getState().selectFile(null);

      expect(useFileStore.getState().selectedFileId).toBeNull();
    });
  });

  describe("updateFile", () => {
    it("파일 상태를 업데이트한다", () => {
      useFileStore.getState().addFiles(["/path/to/doc.hwpx"]);
      const fileId = useFileStore.getState().files[0].id;

      useFileStore.getState().updateFile(fileId, { status: "converting" });

      expect(useFileStore.getState().files[0].status).toBe("converting");
    });

    it("변환 결과를 저장한다", () => {
      useFileStore.getState().addFiles(["/path/to/doc.hwpx"]);
      const fileId = useFileStore.getState().files[0].id;

      const result = {
        markdown: "# Hello",
        format: "hwpx" as const,
        elapsed: 150,
        imageCount: 2,
      };
      useFileStore.getState().updateFile(fileId, { status: "done", result });

      const file = useFileStore.getState().files[0];
      expect(file.status).toBe("done");
      expect(file.result?.markdown).toBe("# Hello");
      expect(file.result?.elapsed).toBe(150);
    });

    it("에러 메시지를 저장한다", () => {
      useFileStore.getState().addFiles(["/path/to/doc.hwpx"]);
      const fileId = useFileStore.getState().files[0].id;

      useFileStore.getState().updateFile(fileId, {
        status: "error",
        error: "변환 실패",
      });

      const file = useFileStore.getState().files[0];
      expect(file.status).toBe("error");
      expect(file.error).toBe("변환 실패");
    });

    it("다른 파일에는 영향을 주지 않는다 (불변성)", () => {
      useFileStore.getState().addFiles(["/path/to/a.hwpx", "/path/to/b.docx"]);
      const [first, second] = useFileStore.getState().files;

      useFileStore.getState().updateFile(first.id, { status: "converting" });

      expect(useFileStore.getState().files[1].status).toBe("pending");
      expect(useFileStore.getState().files[1].id).toBe(second.id);
    });
  });

  describe("removeFile", () => {
    it("파일을 제거한다", () => {
      useFileStore.getState().addFiles(["/path/to/a.hwpx", "/path/to/b.docx"]);
      const firstId = useFileStore.getState().files[0].id;

      useFileStore.getState().removeFile(firstId);

      const { files } = useFileStore.getState();
      expect(files).toHaveLength(1);
      expect(files[0].format).toBe("docx");
    });

    it("선택된 파일을 제거하면 선택이 해제된다", () => {
      useFileStore.getState().addFiles(["/path/to/a.hwpx"]);
      const fileId = useFileStore.getState().files[0].id;

      useFileStore.getState().removeFile(fileId);

      expect(useFileStore.getState().selectedFileId).toBeNull();
    });

    it("선택되지 않은 파일을 제거해도 선택이 유지된다", () => {
      useFileStore.getState().addFiles(["/path/to/a.hwpx", "/path/to/b.docx"]);
      const [first, second] = useFileStore.getState().files;
      useFileStore.getState().selectFile(first.id);

      useFileStore.getState().removeFile(second.id);

      expect(useFileStore.getState().selectedFileId).toBe(first.id);
    });
  });

  describe("clearFiles", () => {
    it("모든 파일과 선택 상태를 초기화한다", () => {
      useFileStore.getState().addFiles(["/path/to/a.hwpx", "/path/to/b.docx"]);

      useFileStore.getState().clearFiles();

      const state = useFileStore.getState();
      expect(state.files).toHaveLength(0);
      expect(state.selectedFileId).toBeNull();
    });
  });
});
