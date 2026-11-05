/* "Request access" tab of the marketplace (v1.73 — split out of MarketplaceViewC, finding F-F6). The chosen product
   is controlled by the composer so a preset ("Request access" on a gold schema) can select it without a remount. */
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useT } from "../../i18n.jsx";
import { useToast } from "../../toast-context.jsx";
import { apiPost } from "../../lib/api.js";
import { Field } from "../ui.jsx";

export function AccessForm({ products, productId, onProductChange, onSubmitted }) {
  const { t } = useT();
  const { flash } = useToast();
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const product = products.find((p) => p.id === productId);
  const submit = async () => {
    setBusy(true);
    try {
      await apiPost("/api/marketplace/requests", { kind: "access", productRef: productId, productLabel: product?.label, purpose });
      if (product?.ownerName) flash("Access to {product} requested — owner {owner} will review it", { product: product.label, owner: product.ownerName }); else flash("Access to {product} requested", { product: product?.label });
      setPurpose(""); onSubmitted();
    } catch (e) { flash("Could not submit — {error}", { error: e.message }); }
    setBusy(false);
  };
  return (
    <div className="panel" style={{ padding: 18, marginTop: 14, maxWidth: 760 }}>
      <Field label={t("Data product")}>
        <select value={productId} onChange={(e) => onProductChange(e.target.value)}>
          <option value="">{t("— choose data product —")}</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
      {product?.ownerName && <div className="modal-sub" style={{ marginTop: -6 }}>{t("Data owner")}: {product.ownerName}</div>}
      <Field label={t("Purpose — what do you need the data for? (required)")}><textarea rows={5} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Monthly loss-ratio reporting for the DE motor portfolio; read-only, refreshed weekly." style={{ width: "100%" }} /></Field>
      <div className="modal-actions"><button className="btn btn-primary" disabled={busy || !productId || !purpose.trim()} onClick={submit}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {t("Request access")}</button></div>
    </div>
  );
}
