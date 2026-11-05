/* Document migration and seeding on the server (v1.66). Until v1.65 the browser ran migrate() on every load and the
   first account that could write saved the upgrade as an ordinary delta — guests and agents saw an upgraded picture
   while the database kept the old one. Now the server upgrades the stored document once at start-up (and after a
   dump restore) and seeds a fresh installation itself, so every client receives a current document. */
import { assembleLite, applyChanges, writeCatalog, summariseEntries } from "./catalog-store.js";
import { COLL } from "./catalog-tables.js";
import { q } from "./db.js";
import { systemActor } from "./config.js";
import { changesBetween } from "../catalog-diff.js";
import { migrate, seed } from "../src/lib/model.js";

const SYSTEM = systemActor("Catalog migration");
const COLL_KEYS = new Set(COLL.map(([key]) => key));
const extraOf = (doc) => Object.fromEntries(Object.entries(doc).filter(([k]) => !COLL_KEYS.has(k)));

export const migrateStoredCatalog = async (reason = "start-up") => {
  const { catalog: prev, version } = await assembleLite();
  if (!prev) return { seeded: false, changes: 0 };
  const empty = !(prev.hubs?.length || prev.databases?.length);
  if (empty && Number(version) === 0) {
    const doc = migrate(seed());
    const r = await writeCatalog(doc, 0, SYSTEM, (entries) => summariseEntries(entries, SYSTEM, "Initial catalog (seed)", "seed"));
    console.log(`Seeded a fresh catalog (${doc.hubs.length} data hub types incl. SOURCE, version ${r.version})`);
    return { seeded: true, changes: 0 };
  }
  const next = migrate(structuredClone(prev));
  const changes = changesBetween(prev, next);
  let applied = 0;
  if (changes.length) {
    await applyChanges(SYSTEM, changes, { authorize: false });
    applied = changes.length;
  }
  const ePrev = JSON.stringify(extraOf(prev)), eNext = JSON.stringify(extraOf(next));
  if (ePrev !== eNext) await q("UPDATE catalog_meta SET extra = ? WHERE id = 1", [eNext]);
  if (applied || ePrev !== eNext) console.log(`Catalog document upgraded at ${reason}: ${applied} change(s)${ePrev !== eNext ? " + document flags" : ""}`);
  return { seeded: false, changes: applied };
};
