/* v1.66.1 — security review: SSRF guard, scrypt upgrade path, TOTP replay protection, secrets at rest */
import { describe, it, expect } from "vitest";
import { isPrivateAddress, assertPublicTarget, request } from "../../server/connectors/http.js";
import { scryptHash, scryptVerify, scryptNeedsUpgrade, totpMatch, totpAt, sealSecret, openSecret } from "../../server/crypto.js";
import crypto from "node:crypto";

describe("connector SSRF guard", () => {
  it("classifies private, loopback, link-local and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::5", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "52.1.2.3", "2606:4700::1111", "172.32.0.1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuses internal targets and non-http schemes before any connection is made", async () => {
    delete process.env.CONNECTORS_ALLOW_PRIVATE;
    await expect(assertPublicTarget(new URL("http://127.0.0.1:8080/x"))).rejects.toThrow(/internal addresses/);
    await expect(assertPublicTarget(new URL("http://169.254.169.254/latest/meta-data/"))).rejects.toThrow(/internal addresses/);
    await expect(assertPublicTarget(new URL("http://localhost/"))).rejects.toThrow(/internal addresses/);
    await expect(request("file:///etc/passwd")).rejects.toThrow(/Unsupported URL scheme/);
    await expect(request("http://10.0.0.1/", { tlsVerify: false })).rejects.toThrow(/internal addresses/);
  });
});

describe("password hashing", () => {
  it("hashes with scrypt N=2^17, verifies legacy hashes and flags them for upgrade", async () => {
    const h = await scryptHash("correct horse");
    expect(h.startsWith("s2$131072$")).toBe(true);
    expect(await scryptVerify("correct horse", h)).toBe(true); expect(await scryptVerify("wrong", h)).toBe(false); expect(scryptNeedsUpgrade(h)).toBe(false);
    const salt = crypto.randomBytes(16); const legacy = `${salt.toString("hex")}:${crypto.scryptSync("old pw", salt, 64).toString("hex")}`;
    expect(await scryptVerify("old pw", legacy)).toBe(true); expect(scryptNeedsUpgrade(legacy)).toBe(true);
    expect(await scryptVerify("x", "garbage")).toBe(false);
  }, 20000);
});

describe("TOTP replay protection", () => {
  it("accepts a code once and rejects it (and older ones) afterwards", () => {
    const secret = "JBSWY3DPEHPK3PXP"; const c = Math.floor(Date.now() / 1000 / 30);
    const code = totpAt(secret, c);
    expect(totpMatch(secret, code)).toBe(c);
    expect(totpMatch(secret, code, c)).toBe(null);            /* same step already used */
    expect(totpMatch(secret, totpAt(secret, c - 1), c)).toBe(null);
    expect(totpMatch(secret, totpAt(secret, c + 1), c)).toBe(c + 1);
    expect(totpMatch(secret, "12345", null)).toBe(null); expect(totpMatch(secret, "000000x", null)).toBe(null);
  });
});

describe("secrets at rest", () => {
  it("seals and opens with SECRETS_KEY and passes plaintext through without one", () => {
    const prev = process.env.SECRETS_KEY;
    delete process.env.SECRETS_KEY;
    expect(sealSecret("dapi123")).toBe("dapi123"); expect(openSecret("dapi123")).toBe("dapi123");
    process.env.SECRETS_KEY = "test-key";
    const sealed = sealSecret("dapi123");
    expect(sealed.startsWith("enc:v1:")).toBe(true); expect(sealed).not.toContain("dapi123"); expect(openSecret(sealed)).toBe("dapi123"); expect(sealSecret(sealed)).toBe(sealed);
    expect(sealSecret("")).toBe("");
    delete process.env.SECRETS_KEY;
    expect(() => openSecret(sealed)).toThrow(/SECRETS_KEY/);
    if (prev !== undefined) process.env.SECRETS_KEY = prev;
  });
});
