/* Browser download helpers (the only place that touches the DOM for file downloads). */
import { csrfToken } from "./csrf.js";
export function downloadBlob(blob, filename, revokeAfterMs = 0) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  if (revokeAfterMs) setTimeout(() => URL.revokeObjectURL(a.href), revokeAfterMs);
  else URL.revokeObjectURL(a.href);
}
export const downloadText = (text, filename, type = "text/plain") => downloadBlob(new Blob([text], { type }), filename);
export const downloadJson = (obj, filename) => downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), filename, 2000);

/* reads a File as base64 (payload only, without the data: prefix) */
export const fileToBase64 = (file) => new Promise((res, rej) => {
  const rd = new FileReader();
  rd.onload = () => res(String(rd.result).split(",")[1]);
  rd.onerror = () => rej(new Error("read failed"));
  rd.readAsDataURL(file);
});

/* lets the browser download a server-rendered file natively: a hidden form POST (GET when no fields) — cookies are
   sent, the response's Content-Disposition triggers the download, nothing is buffered in JavaScript */
export function submitDownload(url, fields = null) {
  const form = document.createElement("form");
  form.method = fields ? "POST" : "GET"; form.action = url; form.style.display = "none";
  for (const [k, v] of Object.entries(fields ? { ...fields, _csrf: csrfToken() } : {})) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; form.appendChild(i); }
  document.body.appendChild(form);
  form.submit();
  setTimeout(() => form.remove(), 1000);
}
