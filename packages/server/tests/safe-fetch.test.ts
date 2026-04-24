import { describe, expect, it, vi } from "vitest";
import { isBlockedIp, safeFetch } from "../src/fetch/index.js";

interface DnsStubEntry {
  readonly host: string;
  readonly address: string;
  readonly family: number;
}

function makeDnsStub(entries: ReadonlyArray<DnsStubEntry>) {
  return async (host: string, _options?: unknown) => {
    const matches = entries.filter((e) => e.host === host);
    if (matches.length === 0) {
      const err = new Error(`ENOTFOUND ${host}`) as Error & { code: string };
      err.code = "ENOTFOUND";
      throw err;
    }
    return matches.map((m) => ({ address: m.address, family: m.family }));
  };
}

describe("isBlockedIp", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.0.0.1", true],
    ["172.16.5.9", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true], // AWS metadata
    ["0.0.0.0", true],
    ["255.255.255.255", true],
    ["224.0.0.1", true], // multicast
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["172.15.0.1", false], // just outside RFC1918
    ["172.32.0.1", false],
    ["::1", true],
    ["::", true],
    ["fc00::1", true],
    ["fe80::1", true],
    ["ff02::1", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:8.8.8.8", false],
    ["2001:4860:4860::8888", false], // Google DNS IPv6
  ])("isBlockedIp(%s) === %s", (ip, expected) => {
    expect(isBlockedIp(ip)).toBe(expected);
  });
});

describe("safeFetch — scheme", () => {
  it("blocks file:// scheme", async () => {
    const result = await safeFetch("file:///etc/passwd", {
      maxBytes: 1024,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("scheme-blocked");
    }
  });

  it("blocks data: scheme", async () => {
    const result = await safeFetch("data:text/plain,hello", {
      maxBytes: 1024,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("scheme-blocked");
    }
  });

  it("rejects malformed URL", async () => {
    const result = await safeFetch("not-a-url", {
      maxBytes: 1024,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
  });
});

describe("safeFetch — host blocking", () => {
  it("blocks URLs resolving to loopback", async () => {
    const result = await safeFetch("http://evil.example.com/file.pdf", {
      maxBytes: 1024,
      timeoutMs: 1000,
      dnsLookup: makeDnsStub([
        { host: "evil.example.com", address: "127.0.0.1", family: 4 },
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("host-blocked");
    }
  });

  it("blocks URLs resolving to AWS metadata", async () => {
    const result = await safeFetch("http://169.254.169.254/latest/meta-data/", {
      maxBytes: 1024,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("host-blocked");
    }
  });

  it("blocks literal private IP", async () => {
    const result = await safeFetch("http://10.0.0.1/file", {
      maxBytes: 1024,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("host-blocked");
    }
  });

  it("blocks when DNS lookup fails", async () => {
    const result = await safeFetch("http://nonexistent.invalid/file", {
      maxBytes: 1024,
      timeoutMs: 1000,
      dnsLookup: makeDnsStub([]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("host-blocked");
    }
  });

  it("blocks if any resolved IP is private", async () => {
    const result = await safeFetch("http://dualstack.example.com/file", {
      maxBytes: 1024,
      timeoutMs: 1000,
      dnsLookup: makeDnsStub([
        { host: "dualstack.example.com", address: "1.2.3.4", family: 4 },
        { host: "dualstack.example.com", address: "10.0.0.1", family: 4 },
      ]),
    });
    expect(result.ok).toBe(false);
  });
});

describe("safeFetch — success paths", () => {
  it("fetches a public URL and returns bytes", async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    const result = await safeFetch("http://example.com/file.pdf", {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: fetchStub,
      dnsLookup: makeDnsStub([
        { host: "example.com", address: "93.184.216.34", family: 4 },
      ]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.byteLength).toBe(3);
      expect(result.contentType).toBe("application/pdf");
    }
  });
});

describe("safeFetch — redirects", () => {
  it("follows a safe redirect", async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://cdn.example.com/final.pdf" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([7, 7, 7]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
      );
    const result = await safeFetch("http://example.com/redir", {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: fetchStub,
      dnsLookup: makeDnsStub([
        { host: "example.com", address: "93.184.216.34", family: 4 },
        { host: "cdn.example.com", address: "93.184.216.35", family: 4 },
      ]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("http://cdn.example.com/final.pdf");
    }
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("rejects redirect that lands on private IP host", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://internal.example.com/secret" },
      }),
    );
    const result = await safeFetch("http://example.com/redir", {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: fetchStub,
      dnsLookup: makeDnsStub([
        { host: "example.com", address: "93.184.216.34", family: 4 },
        { host: "internal.example.com", address: "10.0.0.5", family: 4 },
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("host-blocked");
    }
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("rejects redirect loop exceeding limit", async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://example.com/next" },
      });
    const result = await safeFetch("http://example.com/start", {
      maxBytes: 1024,
      timeoutMs: 1000,
      maxRedirects: 2,
      fetchImpl: fetchStub,
      dnsLookup: makeDnsStub([
        { host: "example.com", address: "93.184.216.34", family: 4 },
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("redirect-loop");
    }
  });
});

describe("safeFetch — size limits", () => {
  it("rejects oversized Content-Length upfront", async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(new Uint8Array(100), {
        status: 200,
        headers: {
          "content-length": "9999",
          "content-type": "application/pdf",
        },
      });
    const result = await safeFetch("http://example.com/big", {
      maxBytes: 1000,
      timeoutMs: 1000,
      fetchImpl: fetchStub,
      dnsLookup: makeDnsStub([
        { host: "example.com", address: "93.184.216.34", family: 4 },
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too-large");
    }
  });

  it("rejects streaming body that exceeds limit", async () => {
    const big = new Uint8Array(2000);
    const fetchStub: typeof fetch = async () =>
      new Response(big, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    const result = await safeFetch("http://example.com/stream", {
      maxBytes: 1000,
      timeoutMs: 1000,
      fetchImpl: fetchStub,
      dnsLookup: makeDnsStub([
        { host: "example.com", address: "93.184.216.34", family: 4 },
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too-large");
    }
  });
});

describe("safeFetch — HTTP errors", () => {
  it("propagates non-2xx final response as http-error", async () => {
    const fetchStub: typeof fetch = async () =>
      new Response(null, { status: 404 });
    const result = await safeFetch("http://example.com/missing", {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: fetchStub,
      dnsLookup: makeDnsStub([
        { host: "example.com", address: "93.184.216.34", family: 4 },
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("http-error");
      expect(result.status).toBe(404);
    }
  });

  it("surfaces network errors", async () => {
    const fetchStub: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const result = await safeFetch("http://example.com/x", {
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: fetchStub,
      dnsLookup: makeDnsStub([
        { host: "example.com", address: "93.184.216.34", family: 4 },
      ]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network-error");
    }
  });
});
