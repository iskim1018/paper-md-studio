import { createHmac, timingSafeEqual } from "node:crypto";

export interface ApiKeyStore {
  /** 인증이 활성화되어 있는지 (false면 미들웨어는 모든 요청을 통과시킨다) */
  readonly enabled: boolean;
  isValid(candidate: string): Promise<boolean>;
}

export interface MemoryApiKeyStoreOptions {
  readonly keys: ReadonlyArray<string>;
  readonly signingSecret: string;
}

/**
 * 메모리 기반 API Key 저장소.
 *
 * 원본 키는 메모리에 유지하지 않고 HMAC-SHA256 해시만 보관한다.
 * 비교는 crypto.timingSafeEqual 로 constant-time 수행한다.
 */
export class MemoryApiKeyStore implements ApiKeyStore {
  private readonly signingSecret: string;
  private readonly hashed: ReadonlyArray<Buffer>;
  public readonly enabled: boolean;

  constructor(options: MemoryApiKeyStoreOptions) {
    this.signingSecret = options.signingSecret;
    this.hashed = options.keys
      .filter((k) => k.length > 0)
      .map((k) => hmac(options.signingSecret, k));
    this.enabled = this.hashed.length > 0;
  }

  async isValid(candidate: string): Promise<boolean> {
    if (!this.enabled) {
      return true;
    }
    if (!candidate) {
      return false;
    }
    const candidateDigest = hmac(this.signingSecret, candidate);
    for (const stored of this.hashed) {
      if (candidateDigest.length !== stored.length) {
        continue;
      }
      if (timingSafeEqual(candidateDigest, stored)) {
        return true;
      }
    }
    return false;
  }
}

function hmac(secret: string, key: string): Buffer {
  return createHmac("sha256", secret).update(key).digest();
}
