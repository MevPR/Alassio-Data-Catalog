import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ImportProgressModalC } from "../../src/components/import-progress.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/* minimal XMLHttpRequest stand-in: reports upload progress, then answers with the job */
class FakeXhr {
  static last = null;
  constructor() { this.upload = {}; this.headers = {}; FakeXhr.last = this; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(body) {
    this.body = body;
    setTimeout(() => { this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 }); }, 0);
    setTimeout(() => { this.status = 200; this.responseText = JSON.stringify({ job: { id: "j1", status: "running", phase: "parsing", fileName: "x.csv", bytesTotal: 10, bytesRead: 0, rowsRead: 0, rowsWritten: 0, rowsToWrite: 0, warnings: [] } }); this.onload(); }, 5);
  }
  abort() { this.onabort?.(); }
}

describe("ImportProgressModalC", () => {
  it("uploads, polls the job through its phases and reports the result", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const polls = [
      { id: "j1", status: "running", phase: "parsing", bytesTotal: 10, bytesRead: 5, rowsRead: 1200, rowsWritten: 0, rowsToWrite: 0, warnings: [] },
      { id: "j1", status: "running", phase: "writing", bytesTotal: 10, bytesRead: 10, rowsRead: 4000, rowsWritten: 500, rowsToWrite: 1000, warnings: ["CSV has no \"data_hub_type\" column"] },
      { id: "j1", status: "done", phase: "done", bytesTotal: 10, bytesRead: 10, rowsRead: 4000, rowsWritten: 1000, rowsToWrite: 1000, counts: { hubs: 0, databases: 1, schemas: 2, tables: 30, attributes: 967, domains: 0, people: 0, total: 1000 }, warnings: ["CSV has no \"data_hub_type\" column"] },
    ];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ job: polls[Math.min(n++, polls.length - 1)] }) })));
    const onDone = vi.fn(); const onClose = vi.fn();
    const file = new File(["data_hub_type,database\nH,D\n"], "x.csv", { type: "text/csv" });
    render(<ImportProgressModalC file={file} onClose={onClose} onDone={onDone} pollMs={5} />);
    expect(screen.getByText(/Uploading/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Reading and merging rows/)).toBeTruthy());
    expect(FakeXhr.last.headers["X-File-Name"]).toBe("x.csv");
    expect(FakeXhr.last.url).toBe("/api/import/csv");
    await waitFor(() => expect(screen.getByText(/Writing to the database/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Import completed")).toBeTruthy());
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
    expect(screen.getByText(/967 Attributes/)).toBeTruthy();
    expect(screen.getByText(/no "data_hub_type" column/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Close/ }).pop());
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server error and allows closing", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ job: { id: "j1", status: "error", phase: "error", error: 'columns "table" and "attribute" are required', warnings: [] } }) })));
    const onDone = vi.fn();
    render(<ImportProgressModalC file={new File(["a"], "bad.csv")} onClose={() => {}} onDone={onDone} pollMs={5} />);
    await waitFor(() => expect(screen.getByText("Import failed")).toBeTruthy());
    expect(screen.getByText(/are required/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
