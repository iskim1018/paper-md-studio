import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { extFromMime } from "@paper-md-studio/core";
import { makeConversionId, shardPrefix } from "./conversion-id.js";
import type {
  PutConversionInput,
  StorageAdapter,
  StoredImage,
  StoredImageInfo,
  StoredMeta,
} from "./types.js";

export interface LocalFsStorageOptions {
  readonly root: string;
}

const META_FILENAME = "meta.json";
const MARKDOWN_FILENAME = "markdown.md";
const IMAGES_DIRNAME = "images";

export class LocalFsStorage implements StorageAdapter {
  private readonly root: string;

  constructor(options: LocalFsStorageOptions) {
    this.root = options.root;
  }

  async has(conversionId: string): Promise<boolean> {
    try {
      await stat(this.metaPath(conversionId));
      return true;
    } catch {
      return false;
    }
  }

  async put(input: PutConversionInput): Promise<StoredMeta> {
    const conversionId = makeConversionId(input.sha256);
    const dir = this.conversionDir(conversionId);
    const imagesDir = join(dir, IMAGES_DIRNAME);

    await mkdir(imagesDir, { recursive: true });

    const imageInfos: Array<StoredImageInfo> = [];
    for (const img of input.images) {
      const name = safeImageName(img.name, img.mimeType);
      await writeFile(join(imagesDir, name), img.data);
      imageInfos.push({
        name,
        mimeType: img.mimeType,
        size: img.data.byteLength,
      });
    }

    await writeFile(join(dir, MARKDOWN_FILENAME), input.markdown, "utf-8");

    const meta: StoredMeta = {
      conversionId,
      format: input.format,
      sha256: input.sha256,
      createdAt: new Date().toISOString(),
      elapsed: input.elapsed,
      originalName: input.originalName,
      size: input.size,
      images: imageInfos,
    };

    await writeFile(
      join(dir, META_FILENAME),
      JSON.stringify(meta, null, 2),
      "utf-8",
    );

    return meta;
  }

  async getMeta(conversionId: string): Promise<StoredMeta | null> {
    try {
      const raw = await readFile(this.metaPath(conversionId), "utf-8");
      return JSON.parse(raw) as StoredMeta;
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async getMarkdown(conversionId: string): Promise<string | null> {
    try {
      return await readFile(
        join(this.conversionDir(conversionId), MARKDOWN_FILENAME),
        "utf-8",
      );
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async getImage(
    conversionId: string,
    name: string,
  ): Promise<StoredImage | null> {
    const meta = await this.getMeta(conversionId);
    if (!meta) {
      return null;
    }
    const info = meta.images.find((img) => img.name === name);
    if (!info) {
      return null;
    }
    try {
      const data = await readFile(
        join(this.conversionDir(conversionId), IMAGES_DIRNAME, info.name),
      );
      return {
        data: new Uint8Array(data),
        mimeType: info.mimeType,
        size: info.size,
      };
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(conversionId: string): Promise<void> {
    await rm(this.conversionDir(conversionId), {
      recursive: true,
      force: true,
    });
  }

  async list(): Promise<ReadonlyArray<StoredMeta>> {
    const results: Array<StoredMeta> = [];
    let shards: Array<string>;
    try {
      shards = await readdir(this.root);
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return results;
      }
      throw error;
    }

    for (const shard of shards) {
      if (!/^[a-f0-9]{2}$/.test(shard)) {
        continue;
      }
      const shardDir = join(this.root, shard);
      const conversions = await readdir(shardDir);
      for (const id of conversions) {
        if (!/^[a-f0-9]{64}$/.test(id)) {
          continue;
        }
        const meta = await this.getMeta(id);
        if (meta) {
          results.push(meta);
        }
      }
    }

    return results;
  }

  private conversionDir(conversionId: string): string {
    return join(this.root, shardPrefix(conversionId), conversionId);
  }

  private metaPath(conversionId: string): string {
    return join(this.conversionDir(conversionId), META_FILENAME);
  }
}

function safeImageName(originalName: string, mimeType: string): string {
  const sanitized = originalName.replace(/[^\w.-]/g, "_");
  if (sanitized.length > 0 && /\.[^.]+$/.test(sanitized)) {
    return sanitized;
  }
  const ext = extFromMime(mimeType);
  return `${sanitized || "image"}${ext}`;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "ENOENT"
  );
}
