import {
  createImageAsset,
  imageToHtml,
  makeImageName,
  mimeFromExt,
} from "../../image-utils.js";
import type { ImageAsset } from "../../types.js";

/** 그대로 저장해 Markdown에서 보여줄 수 있는 그림 형식 */
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".svg",
  ".webp",
]);

/**
 * 한글 문서에 흔하지만 브라우저·Markdown 뷰어가 그리지 못하는 벡터 메타파일.
 * 변환 도구도 없어 빼되, 조용히 사라지지 않게 개수를 경고한다
 * (실물 표본 한 건에서 5개가 아무 표시 없이 빠졌다).
 */
const METAFILE_EXTENSIONS = new Set([".wmf", ".emf"]);

function extensionOf(path: string): string {
  const match = /\.[^./]+$/.exec(path.toLowerCase());
  return match ? match[0] : "";
}

/** 그대로 저장할 수 있는 그림 형식의 경로인지 (ZIP 에서 풀 항목 고르기용) */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

function fileNameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * HWPX 그림 참조(`binaryItemIDRef`)를 ZIP 안 BinData 파일로 풀어 ImageAsset을
 * 모으고 `<img>` 태그를 만든다.
 *
 * 참조는 파일명(`image1.png`) 또는 확장자를 뺀 이름(`image1`)으로 온다. 같은
 * 그림을 여러 자리에서 참조하면(묶음 개체 속 반복 그림 등) 파일은 한 번만
 * 저장하고 자리마다 같은 파일을 가리킨다 — 종전엔 두 번째 자리를 지웠다.
 */
export class ImageCollector {
  readonly images: Array<ImageAsset> = [];
  private readonly lookup = new Map<string, string>();
  private readonly metafiles = new Set<string>();
  private readonly placed = new Map<string, string>();
  private skippedMetafileCount = 0;

  /**
   * @param files 푼 항목 (그림은 여기서 찾는다)
   * @param entryNames ZIP 의 모든 항목 이름 — WMF/EMF 는 풀지 않으므로 이름만 본다
   */
  constructor(
    private readonly imagesDirName: string,
    private readonly files: Readonly<Record<string, Uint8Array>>,
    entryNames: ReadonlyArray<string> = Object.keys(files),
  ) {
    for (const [path, data] of Object.entries(files)) {
      if (isImagePath(path) && data.length > 0) {
        this.register(fileNameOf(path), path);
      }
    }
    for (const path of entryNames) {
      if (!METAFILE_EXTENSIONS.has(extensionOf(path))) continue;
      const name = fileNameOf(path);
      this.metafiles.add(name);
      this.metafiles.add(name.replace(/\.[^.]+$/, ""));
    }
  }

  /** 변환할 수 없어 뺀 WMF/EMF 그림 자리 수 */
  get skippedMetafiles(): number {
    return this.skippedMetafileCount;
  }

  /** 그림 참조 하나를 `<img>` HTML로 바꾼다. 찾을 수 없으면 null */
  place(binRef: string): string | null {
    if (!binRef) return null;
    const path = this.lookup.get(binRef);
    if (!path) {
      if (this.metafiles.has(binRef)) this.skippedMetafileCount += 1;
      return null;
    }
    const fileName = fileNameOf(path);
    const existing = this.placed.get(path);
    if (existing) return imageToHtml(this.imagesDirName, existing, fileName);

    const data = this.files[path];
    if (!data) return null;
    const imageName = makeImageName(this.images.length + 1, extensionOf(path));
    this.images.push(createImageAsset(imageName, data, mimeFromExt(path)));
    this.placed.set(path, imageName);
    return imageToHtml(this.imagesDirName, imageName, fileName);
  }

  private register(name: string, path: string): void {
    // 먼저 등록된 파일이 이긴다 (같은 이름이 여러 폴더에 있는 비정상 파일)
    if (!this.lookup.has(name)) this.lookup.set(name, path);
    const bare = name.replace(/\.[^.]+$/, "");
    if (!this.lookup.has(bare)) this.lookup.set(bare, path);
  }
}
