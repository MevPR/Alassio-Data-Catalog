import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-storage-test-"));
const { s3Sign, storage, storageInfo, STORAGE } = await import("../../server/storage.js");

describe("S3 SigV4", () => {
  it("reproduces the AWS documentation example signature (GET object with Range)", () => {
    const h = s3Sign({ method: "GET", host: "examplebucket.s3.amazonaws.com", pathName: "/test.txt", headers: { Range: "bytes=0-9" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", region: "us-east-1",
      accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", now: new Date("2013-05-24T00:00:00Z") });
    expect(h["x-amz-date"]).toBe("20130524T000000Z");
    expect(h.Authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
});

describe("local storage provider", () => {
  it("puts, stats, streams, resolves to a local path and deletes", async () => {
    expect(STORAGE).toBe("local"); expect(storageInfo().provider).toBe("local");
    const { size } = await storage.put("a.txt", Buffer.from("hello"));
    expect(size).toBe(5);
    expect(await storage.stat("a.txt")).toEqual({ size: 5 });
    let text = ""; for await (const c of await storage.get("a.txt")) text += c; expect(text).toBe("hello");
    const src = path.join(process.env.BACKUP_DIR, "src.bin"); fs.writeFileSync(src, "xyz");
    expect((await storage.put("b.bin", src)).size).toBe(3);
    const local = await storage.toLocal("b.bin"); expect(fs.readFileSync(local.path, "utf8")).toBe("xyz");
    await storage.delete("a.txt"); expect(await storage.stat("a.txt")).toBeNull();
    await expect(storage.get("missing")).rejects.toThrow();
  });
});
