import { describe, expect, it } from "vitest";
import { createSignedUrlSigner } from "../src/auth/index.js";

const SECRET = "test-secret-abcdefghijklmnop";

describe("createSignedUrlSigner", () => {
  it("sign → verify 라운드트립이 성공한다", () => {
    const signer = createSignedUrlSigner({
      secret: SECRET,
      ttlSeconds: 900,
    });
    const { exp, sig } = signer.sign({
      conversionId: "abc123",
      name: "img_001.png",
    });
    const result = signer.verify({
      conversionId: "abc123",
      name: "img_001.png",
      exp,
      sig,
    });
    expect(result.ok).toBe(true);
  });

  it("서명 변조는 invalid 로 거부된다", () => {
    const signer = createSignedUrlSigner({ secret: SECRET, ttlSeconds: 900 });
    const { exp, sig } = signer.sign({
      conversionId: "abc123",
      name: "img_001.png",
    });
    const tampered = `${sig.slice(0, -1)}0`;
    const result = signer.verify({
      conversionId: "abc123",
      name: "img_001.png",
      exp,
      sig: tampered,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
    }
  });

  it("conversionId 가 다르면 invalid", () => {
    const signer = createSignedUrlSigner({ secret: SECRET, ttlSeconds: 900 });
    const { exp, sig } = signer.sign({
      conversionId: "aaa",
      name: "img_001.png",
    });
    const result = signer.verify({
      conversionId: "bbb",
      name: "img_001.png",
      exp,
      sig,
    });
    expect(result.ok).toBe(false);
  });

  it("name 이 다르면 invalid", () => {
    const signer = createSignedUrlSigner({ secret: SECRET, ttlSeconds: 900 });
    const { exp, sig } = signer.sign({
      conversionId: "abc",
      name: "a.png",
    });
    const result = signer.verify({
      conversionId: "abc",
      name: "b.png",
      exp,
      sig,
    });
    expect(result.ok).toBe(false);
  });

  it("만료된 서명은 expired 로 거부된다", () => {
    const signer = createSignedUrlSigner({ secret: SECRET, ttlSeconds: 900 });
    const past = Math.floor(Date.now() / 1000) - 60;
    // 만료된 exp 에 대해 직접 서명을 만든 뒤 verify
    const { sig } = signer.sign({
      conversionId: "abc",
      name: "x.png",
      nowSeconds: past - 900 + 1, // 거의 만료에 도달한 시점에 서명
    });
    // 실제 verify 시점은 현재
    const result = signer.verify({
      conversionId: "abc",
      name: "x.png",
      exp: past, // 이미 과거
      sig,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("expired");
    }
  });

  it("다른 secret 으로 서명된 토큰은 invalid", () => {
    const a = createSignedUrlSigner({ secret: SECRET, ttlSeconds: 900 });
    const b = createSignedUrlSigner({
      secret: "different-secret-abcdefghij",
      ttlSeconds: 900,
    });
    const { exp, sig } = a.sign({ conversionId: "abc", name: "x.png" });
    const result = b.verify({ conversionId: "abc", name: "x.png", exp, sig });
    expect(result.ok).toBe(false);
  });

  it("sign 은 TTL 내 미래 시각의 exp 를 생성한다", () => {
    const signer = createSignedUrlSigner({ secret: SECRET, ttlSeconds: 60 });
    const before = Math.floor(Date.now() / 1000);
    const { exp } = signer.sign({ conversionId: "abc", name: "x.png" });
    const after = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThanOrEqual(before + 60);
    expect(exp).toBeLessThanOrEqual(after + 61);
  });
});
