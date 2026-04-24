import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignParams {
  readonly conversionId: string;
  readonly name: string;
  /** 테스트용 시간 고정. 미지정 시 현재 시각 사용. */
  readonly nowSeconds?: number;
}

export interface SignResult {
  readonly exp: number;
  readonly sig: string;
}

export interface VerifyParams {
  readonly conversionId: string;
  readonly name: string;
  readonly exp: number;
  readonly sig: string;
  /** 테스트용 시간 고정. 미지정 시 현재 시각 사용. */
  readonly nowSeconds?: number;
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "expired" | "invalid" };

export interface SignedUrlSigner {
  sign(params: SignParams): SignResult;
  verify(params: VerifyParams): VerifyResult;
}

export interface CreateSignedUrlSignerOptions {
  readonly secret: string;
  readonly ttlSeconds: number;
}

export function createSignedUrlSigner(
  options: CreateSignedUrlSignerOptions,
): SignedUrlSigner {
  const { secret, ttlSeconds } = options;

  return {
    sign(params: SignParams): SignResult {
      const now = params.nowSeconds ?? nowSeconds();
      const exp = now + ttlSeconds;
      const sig = computeHmac(secret, params.conversionId, params.name, exp);
      return { exp, sig };
    },
    verify(params: VerifyParams): VerifyResult {
      const now = params.nowSeconds ?? nowSeconds();
      if (params.exp <= now) {
        return { ok: false, reason: "expired" };
      }
      const expected = computeHmac(
        secret,
        params.conversionId,
        params.name,
        params.exp,
      );
      const candidate = Buffer.from(params.sig, "hex");
      const expectedBuf = Buffer.from(expected, "hex");
      if (candidate.length !== expectedBuf.length) {
        return { ok: false, reason: "invalid" };
      }
      if (!timingSafeEqual(candidate, expectedBuf)) {
        return { ok: false, reason: "invalid" };
      }
      return { ok: true };
    },
  };
}

function computeHmac(
  secret: string,
  conversionId: string,
  name: string,
  exp: number,
): string {
  const payload = `${conversionId}:${name}:${exp}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
