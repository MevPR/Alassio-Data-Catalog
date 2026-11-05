/* v1.73 (F-S7): the CSV import job, moved out of routes/import.js — driven with a real temp file and papaparse, and a
   fake store standing in for importBulk (the merge callback runs against a seeded lite document). */
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());
const { runCsvImportJob } = await import("../../server/csv-import-job.js");
const { newJob } = await import("../../server/jobs.js");
const { seed } = await import("../../src/lib/model.js");

const HEADER = "data_hub_type,data_hub,database,schema,table,attribute,data_type";
const writeCsv = (lines) => { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "csvjob-")), "in.csv"); fs.writeFileSync(p, [HEADER, ...lines].join("\n")); return p; };
const jobFor = (tmpPath) => { const j = newJob("csv", { id: "u1", name: "Ada", email: "ada@x.io" }, "in.csv"); j.tmpPath = tmpPath; return j; };
/* fake importBulk: runs the merge on a fresh seeded document and records what each chunk would write */
const fakeStore = () => {
  const calls = [];
  return { calls, importBulk: vi.fn(async (user, merge, onProgress, onPhase) => {
    const out = await merge(seed(), async () => []);
    calls.push({ user, name: out.name, attributes: out.created.attributes.length });
    onPhase("committing"); onProgress(out.created.attributes.length);
    return { version: 10 + calls.length };
  }) };
};

describe("runCsvImportJob", () => {
  it("parses, merges and writes one chunk, then removes the temp file", async () => {
    const tmp = writeCsv(["Health,HEALTH_DE,GOLD,dp,fact,a1,INT", "Health,HEALTH_DE,GOLD,dp,fact,a2,STRING"]);
    const job = jobFor(tmp), store = fakeStore();
    await runCsvImportJob(job, { store });
    expect(job.status).toBe("done");
    expect(job.rowsRead).toBe(2);
    expect(job.version).toBe(11);
    expect(job.chunks).toBe(1);
    expect(store.calls).toEqual([{ user: job.user, name: "CSV import in.csv", attributes: 2 }]);
    expect(job.counts.attributes).toBe(2);
    expect(fs.existsSync(tmp)).toBe(false);
  });
  it("splits into chunks only at a table boundary and names the parts", async () => {
    const tmp = writeCsv(["H,HD,DB,s,t1,a,INT", "H,HD,DB,s,t1,b,INT", "H,HD,DB,s,t1,c,INT", "H,HD,DB,s,t2,a,INT"]);
    const job = jobFor(tmp), store = fakeStore();
    await runCsvImportJob(job, { store, chunkRows: 2 });
    expect(job.status).toBe("done");
    expect(store.calls.map((c) => [c.name, c.attributes])).toEqual([["CSV import in.csv (part 1)", 3], ["CSV import in.csv (part 2)", 1]]);
    expect(job.chunks).toBe(2);
    expect(job.version).toBe(12);
  });
  it("fails the job when the required columns are missing, and when the store throws", async () => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "csvjob-")), "bad.csv"); fs.writeFileSync(p, "database,schema\nDB,s\n");
    const job = jobFor(p);
    await runCsvImportJob(job, { store: fakeStore() });
    expect(job.status).toBe("error");
    expect(job.error).toMatch(/columns "table" and "attribute" are required/);
    const job2 = jobFor(writeCsv(["H,HD,DB,s,t,a,INT"]));
    await runCsvImportJob(job2, { store: { importBulk: async () => { throw new Error("db down"); } } });
    expect(job2).toMatchObject({ status: "error", error: "db down" });
  });
  it("ends as cancelled when the job is cancelled", async () => {
    const job = jobFor(writeCsv(["H,HD,DB,s,t,a,INT"]));
    job.cancelled = true;
    await runCsvImportJob(job, { store: fakeStore() });
    expect(job.status).toBe("cancelled");
  });
});
