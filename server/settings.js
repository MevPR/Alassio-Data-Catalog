/* key/value settings stored in MariaDB (admin-configurable, e.g. Entra sign-in) */
import { q, sql } from "./db.js";
export const getSetting = async (k, dflt = null) => { const r = await q("SELECT v FROM settings WHERE k = ?", [k]); return r.length ? JSON.parse(r[0].v) : dflt; };
export const setSetting = async (k, v, by) => q(sql.upsert("settings", ["k", "v", "updated_ts", "updated_by"], 1, ["k"]), [k, JSON.stringify(v), Date.now(), by?.email || "system"]);
