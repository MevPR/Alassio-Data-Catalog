/* Streams a raw request body into a temp file (used by the CSV import and the dump restore, which are mounted
   before express.json). Resolves with the byte count; rejects with { status, message } on limits or aborts. */
import fs from "fs";
import os from "os";
import path from "path";

export const MAX_UPLOAD_BYTES = Number(process.env.IMPORT_MAX_BYTES || 512 * 1024 * 1024);
export const tmpPathFor = (id, ext) => path.join(os.tmpdir(), `cortex-upload-${id}.${ext}`);
export const tooLarge = () => Object.assign(new Error(`File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB`), { status: 413 });

export const streamToFile = (req, tmpPath) => new Promise((resolve, reject) => {
  if ((Number(req.headers["content-length"]) || 0) > MAX_UPLOAD_BYTES) return reject(tooLarge());
  let received = 0;
  const out = fs.createWriteStream(tmpPath, { mode: 0o600 });
  req.on("data", (chunk) => { received += chunk.length; if (received > MAX_UPLOAD_BYTES) req.destroy(tooLarge()); });
  req.on("error", (e) => reject(e.status ? e : Object.assign(new Error(e.message), { status: 400 })));
  req.on("aborted", () => reject(Object.assign(new Error("upload aborted"), { status: 400 })));
  out.on("error", reject);
  out.on("finish", () => resolve(received));
  req.pipe(out);
});
