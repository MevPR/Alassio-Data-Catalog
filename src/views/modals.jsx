import { useT } from "../i18n.jsx";
import { entityDialogPerms, glossaryDialogPerms } from "../../permissions.js";
import { useActions, useCatalogData, useNav } from "../catalog-context.jsx";
import { useToast } from "../toast-context.jsx";
import { EntityModalC } from "../components/entity-modal.jsx";
import { EdgeMapModalC } from "../components/lineage.jsx";
import { GlossaryTermModalC } from "../components/glossary.jsx";
import { SourceModalC, UnityModalC } from "../components/source-import.jsx";
import { DeprecateModalC } from "../components/stewardship.jsx";
import { SecurityModalC } from "../components/auth.jsx";
import { HistoryModalC } from "../components/admin.jsx";
import { ExportModalC } from "../components/export-modal.jsx";
import { HelpModalC } from "../components/help.jsx";
import { ImportProgressModalC } from "../components/import-progress.jsx";
import { WriteBackModalC } from "../components/writeback.jsx";

/* renders the modal for `modal.kind` (null = none) */
export function ModalHost() {
  const { t: tr } = useT();
  const { flash } = useToast();
  const { me, isAdmin, perm, canStructure, hubs, people, domains, databases, schemas, tables, lineage, glossary, table, attrsOf, tablePath, tableOptions, knownSources, glossaryRefOptions, refLabel, attrCount } = useCatalogData();
  const { modal, setModal, openRef } = useNav();
  const { setMe, downloadExport, restoreRecord, importUnityStarted, importUnityDone, importExternal, importBundle, importCsvDone, importDumpDone, saveGlossaryTerm, addEdgeMapping, removeEdgeMapping, saveEntity } = useActions();
  const close = () => setModal(null);
  if (!modal) return null;
  const exportProps = { hubs, databases, schemas, tables, attrCount, onClose: close };
  switch (modal.kind) {
    case "help": return <HelpModalC isAdmin={isAdmin} roles={me?.roles || (me?.role ? [me.role] : [])} initialChapter={modal.chapter} initialRole={modal.role} onClose={close} />;
    case "importcsv": return <ImportProgressModalC kind="csv" file={modal.file} onClose={close} onDone={importCsvDone} />;
    case "importdump": return <ImportProgressModalC kind="dump" file={modal.file} onClose={close} onDone={importDumpDone} />;
    case "deprecate": return <DeprecateModalC tableId={modal.tableId} onClose={close} />;
    case "restorejob": return <ImportProgressModalC kind="dump" initialJob={modal.job} fileName={modal.fileName} onClose={close} onDone={importDumpDone} />;
    case "export": return <ExportModalC {...exportProps} onExport={(t, s, d) => { downloadExport("csv", t, s, d); close(); }} />;
    case "exportokf": return <ExportModalC {...exportProps} title={tr("Export OKF")} sub={tr("Choose what to export as an Open Knowledge Format (OKF v0.2) bundle — a zip of Markdown files with YAML frontmatter, one concept per file, linked as a graph.")} onExport={(t, s, d) => { downloadExport("okf", t, s, d); close(); }} />;
    case "history": return <HistoryModalC scopeId={modal.scopeId} title={modal.title} canEdit={canStructure} onRestore={restoreRecord} onClose={close} />;
    case "security": return <SecurityModalC me={me} onClose={close} onChanged={(u) => { setMe(u); close(); flash("Security settings updated"); }} />;
    case "unity": return <UnityModalC hubs={hubs} onClose={close} onStarted={importUnityStarted} />;
    case "writeback": return <WriteBackModalC profileId={modal.profileId || null} isAdmin={isAdmin} onClose={close} />;   /* v1.77: preview-first, own changes only */
    case "unityjob": return <ImportProgressModalC kind="unity" initialJob={modal.job} fileName={modal.fileName} onClose={close} onDone={importUnityDone} />;
    case "loadsource": return <SourceModalC hubs={hubs} sources={knownSources.filter((r) => r.kind !== "unity")} onClose={close} onImport={importExternal} onImportBundle={importBundle} />;
    case "glossary": return <GlossaryTermModalC key={modal.edit?.id || "new"} edit={modal.edit} refOptions={glossaryRefOptions} refLabel={refLabel} people={people} domains={domains}
      {...glossaryDialogPerms(perm, modal.edit)} onSave={(f) => saveGlossaryTerm(f, modal.edit?.id)} onClose={close} />;
    case "edgemap": {
      const e = lineage.find((x) => x.id === modal.edgeId);
      if (!e) return null;
      const ft = table(e.from), tt = table(e.to);
      return <EdgeMapModalC edge={e} fromTable={ft} toTable={tt} fromPath={tablePath(ft)} toPath={tablePath(tt)}
        fromAttrs={attrsOf(e.from)} toAttrs={attrsOf(e.to)} canEdit={perm.canEditLineage(e.from, e.to)}
        onAdd={(f, to) => addEdgeMapping(e.id, f, to)} onRemove={(mid) => removeEdgeMapping(e.id, mid)}
        onOpen={(id) => { close(); openRef({ type: "table", id, tab: "lineage" }); }} onClose={close} />;
    }
    default: {
      /* entity create/edit: hub, datahub, database, schema, table, attribute, domain, person, edge */
      return <EntityModalC key={(modal.edit?.id || "new") + modal.kind + (modal.presetCountry || "")} modal={modal} hubs={hubs} people={people} domains={domains} tableOptions={tableOptions} glossaryTerms={glossary}
        perm={entityDialogPerms(perm, modal)} onClose={close} onSave={(f) => saveEntity(modal, f)} />;
    }
  }
}
