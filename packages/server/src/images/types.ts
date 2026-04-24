export type ImageMode = "inline" | "urls" | "refs" | "omit";

export const IMAGE_MODES: ReadonlyArray<ImageMode> = [
  "inline",
  "urls",
  "refs",
  "omit",
];

export interface ResponseImage {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly url?: string;
  readonly uri?: string;
}

export interface InlineTooLargeInfo {
  readonly name: string;
  readonly size: number;
}

export type RewriteResult =
  | {
      readonly ok: true;
      readonly markdown: string;
      readonly responseImages: ReadonlyArray<ResponseImage>;
    }
  | {
      readonly ok: false;
      readonly reason: "inline-image-too-large";
      readonly offenders: ReadonlyArray<InlineTooLargeInfo>;
      readonly limitKb: number;
    };
