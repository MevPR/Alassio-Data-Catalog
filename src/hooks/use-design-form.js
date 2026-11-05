/* The data product design form (v1.73 — finding F-F6): one `form` object instead of eleven useState slots in
   MarketplaceViewC. The proposed tag value is derived (suggested from hub + name) until the user types their own, so
   no effect has to keep it in sync any more.
     form            { editingId, name, hubName, desc, project, useCase, adv, advOpen, tagValue, tagTouched, tableIds }
     set(k, v)       one field;  setAdv(k, v) one advanced field;  setTag(v) a typed tag value;  resetTag() back to the suggestion
     startEdit(r)    load an existing design request;  reset() an empty form (the chosen data hub is kept)
     tagValue        the value that will be submitted;  suggested the derived proposal;  valid  all required fields set
     payload()       the request fields the server expects */
import { useState } from "react";
import { slugName, isSourceHub } from "../lib/model.js";
import { EMPTY_ADV, TAG_KEY } from "../lib/design-workflow.js";

/* the data hub type a new design starts in: the first one that is not the SOURCE type (v1.78: no preferred name) */
export const defaultDesignHub = (hubs) => hubs.find((h) => !isSourceHub(h))?.name || hubs[0]?.name || "";
const emptyForm = (hubName) => ({ editingId: null, name: "", hubName, desc: "", project: "", useCase: "", adv: { ...EMPTY_ADV }, advOpen: false, tagValue: "", tagTouched: false, tableIds: [] });
export const suggestTag = (hubName, name) => (name.trim() ? `${hubName} Gold.${slugName(name)} (${name.trim()})` : "");

export function useDesignForm(initialHub = "") {
  const [form, setForm] = useState(() => emptyForm(initialHub));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setAdv = (k, v) => setForm((f) => ({ ...f, adv: { ...f.adv, [k]: v } }));
  const setTag = (v) => setForm((f) => ({ ...f, tagValue: v, tagTouched: true }));
  const resetTag = () => setForm((f) => ({ ...f, tagValue: "", tagTouched: false }));
  const startEdit = (r) => setForm((f) => ({
    editingId: r.id, name: r.name || "", hubName: r.hub || f.hubName, desc: r.purpose || "", project: r.project || "", useCase: r.useCase || "",
    adv: { ...EMPTY_ADV, ...(r.advanced || {}) }, advOpen: !!r.advanced && Object.values(r.advanced).some(Boolean),
    tagValue: r.tagValue || "", tagTouched: true, tableIds: r.tableIds || [],
  }));
  const reset = () => setForm((f) => emptyForm(f.hubName));
  const suggested = suggestTag(form.hubName, form.name);
  const tagValue = form.tagTouched ? form.tagValue : suggested;
  const valid = !!(form.name.trim() && form.desc.trim() && form.hubName && form.project.trim() && form.useCase.trim());
  const payload = () => ({ name: form.name.trim(), hub: form.hubName, purpose: form.desc, tagKey: TAG_KEY, tagValue, tableIds: form.tableIds, advanced: form.adv, project: form.project.trim(), useCase: form.useCase.trim() });
  return { form, set, setAdv, setTag, resetTag, startEdit, reset, suggested, tagValue, valid, payload };
}
