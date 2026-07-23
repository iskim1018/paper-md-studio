const CONTENT_TYPE_CHARSET = /charset=["']?([\w-]+)/i;
const META_CHARSET =
  /<meta[^>]+charset=["']?([\w-]+)|<meta[^>]+content=["'][^"']*charset=([\w-]+)/i;
/** meta charset 탐지를 위해 살펴볼 선두 바이트 수 */
const SNIFF_BYTES = 2048;

/**
 * HTML 바이트를 문자열로 디코딩한다.
 * charset 우선순위: Content-Type 헤더 → meta charset → UTF-8.
 */
export function decodeHtml(
  bytes: Uint8Array,
  contentType?: string | null,
): string {
  const fromHeader = contentType?.match(CONTENT_TYPE_CHARSET)?.[1];
  const charset = fromHeader ?? sniffMetaCharset(bytes) ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function sniffMetaCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, SNIFF_BYTES));
  const match = head.match(META_CHARSET);
  return match?.[1] ?? match?.[2];
}
