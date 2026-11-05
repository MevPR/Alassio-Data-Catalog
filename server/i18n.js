/* Server-side texts in the recipient's language (v1.57): notifications are rendered per recipient from the
   account's `lang` (EN default). Keys are message ids; every template gets a params object. Languages match the UI:
   en, de, pl, es, fr, it. */
import { q } from "./db.js";
import { UI_LANGS } from "./config.js";

const LOCALE = { en: "en-GB", de: "de-DE", pl: "pl-PL", es: "es-ES", fr: "fr-FR", it: "it-IT" };
const fmtDate = (ts, l) => ts ? new Date(ts).toLocaleDateString(LOCALE[l] || "en-GB") : "";
const KIND = { en: { table: "table", schema: "schema", database: "database", domain: "domain" }, de: { table: "Tabelle", schema: "Schema", database: "Datenbank", domain: "Domäne" }, pl: { table: "tabela", schema: "schemat", database: "baza", domain: "domena" },
  es: { table: "tabla", schema: "esquema", database: "base de datos", domain: "dominio" }, fr: { table: "table", schema: "schéma", database: "base de données", domain: "domaine" }, it: { table: "tabella", schema: "schema", database: "database", domain: "dominio" } };
const REVIEW_LINE = { en: (r, l) => `${r.path} — ${r.status === "due" ? "first review pending" : `review overdue since ${fmtDate(r.nextAt, l)}`}`,
  de: (r, l) => `${r.path} — ${r.status === "due" ? "erstes Review ausstehend" : `Review überfällig seit ${fmtDate(r.nextAt, l)}`}`,
  pl: (r, l) => `${r.path} — ${r.status === "due" ? "pierwszy przegląd oczekuje" : `przegląd zaległy od ${fmtDate(r.nextAt, l)}`}`,
  es: (r, l) => `${r.path} — ${r.status === "due" ? "primera revisión pendiente" : `revisión vencida desde ${fmtDate(r.nextAt, l)}`}`,
  fr: (r, l) => `${r.path} — ${r.status === "due" ? "première revue en attente" : `revue en retard depuis le ${fmtDate(r.nextAt, l)}`}`,
  it: (r, l) => `${r.path} — ${r.status === "due" ? "prima revisione in sospeso" : `revisione scaduta dal ${fmtDate(r.nextAt, l)}`}` };
const ATTEST_LINE = { en: (a, l) => `${KIND.en[a.kind]} ${a.path}${a.lastAt ? ` — last confirmed ${fmtDate(a.lastAt, l)}` : " — never confirmed"}`,
  de: (a, l) => `${KIND.de[a.kind]} ${a.path}${a.lastAt ? ` — zuletzt bestätigt ${fmtDate(a.lastAt, l)}` : " — noch nie bestätigt"}`,
  pl: (a, l) => `${KIND.pl[a.kind]} ${a.path}${a.lastAt ? ` — ostatnio potwierdzono ${fmtDate(a.lastAt, l)}` : " — nigdy nie potwierdzono"}`,
  es: (a, l) => `${KIND.es[a.kind]} ${a.path}${a.lastAt ? ` — confirmada por última vez ${fmtDate(a.lastAt, l)}` : " — nunca confirmada"}`,
  fr: (a, l) => `${KIND.fr[a.kind]} ${a.path}${a.lastAt ? ` — dernière confirmation le ${fmtDate(a.lastAt, l)}` : " — jamais confirmée"}`,
  it: (a, l) => `${KIND.it[a.kind]} ${a.path}${a.lastAt ? ` — ultima conferma ${fmtDate(a.lastAt, l)}` : " — mai confermata"}` };
const list = (items, fmt, l) => items.map((x) => `• ${typeof x === "string" ? x : fmt(x, l)}`).join("\n");
/* the one pluralisation helper (v1.70): count(3, "review", "reviews") → "3 reviews"; `many` also applies when the
   number is only a lower bound (uc_drift: "12+ differences") */
export const count = (n, one, many, { plus = false } = {}) => `${n}${plus ? "+" : ""} ${n === 1 && !plus ? one : many}`;
/* the parts of a reminder subject: only the non-empty counts, comma-joined */
const parts = (...xs) => xs.filter(Boolean).join(", ");
const reasonLine = (label, reason) => reason ? `\n\n${label}: ${reason}` : "";

export const STATUS_TEXT_L10N = {
  en: { submitted: "submitted", refinement_review: "with the Business Analyst / Req. Engineer (refining the design)", sourcing: "with the Business Analyst (documenting the sourcing)", refinement_ok: "refinement approved (sourcing documented)", refinement_rejected: "returned by the Business Analyst",
    owner_review: "waiting for the data owner's approval", owner_approved: "data use approved by the data owner (forwarded to Data Ingestion)", owner_rejected: "declined by the data owner (back with the Business Analyst)",
    ingestion_review: "with Data Ingestion", ingestion_confirmed: "ingested tables confirmed by Data Ingestion", ingestion_ok: "approved by Data Ingestion", ingestion_rejected: "returned by Data Ingestion",
    refine_review: "with the Business Analyst for refinement", refine_ok: "refinement completed by the Business Analyst", refine_rejected: "returned by the Business Analyst (refinement)",
    development: "in development (Data Product Development)", uat: "in user acceptance test (UAT)", sit: "in system integration test (SIT)", release: "being released to PRD", signoff: "awaiting sign-off", development_done: "completed by Data Product Development", development_rejected: "returned by Data Product Development", done: "done", withdrawn: "withdrawn", approved: "approved", rejected: "rejected" },
  de: { submitted: "eingereicht", refinement_review: "beim Business Analyst / Req. Engineer (Design wird verfeinert)", sourcing: "beim Business Analyst (Sourcing wird dokumentiert)", refinement_ok: "Verfeinerung freigegeben (Sourcing dokumentiert)", refinement_rejected: "vom Business Analyst zurückgegeben",
    owner_review: "wartet auf die Freigabe des Data Owners", owner_approved: "Datennutzung vom Data Owner freigegeben (an Data Ingestion weitergeleitet)", owner_rejected: "vom Data Owner abgelehnt (zurück beim Business Analyst)",
    ingestion_review: "bei Data Ingestion", ingestion_confirmed: "ingestierte Tabellen von Data Ingestion bestätigt", ingestion_ok: "von Data Ingestion freigegeben", ingestion_rejected: "von Data Ingestion zurückgegeben",
    refine_review: "beim Business Analyst zur Verfeinerung", refine_ok: "Verfeinerung vom Business Analyst abgeschlossen", refine_rejected: "vom Business Analyst zurückgegeben (Verfeinerung)",
    development: "in Entwicklung (Data Product Development)", uat: "im User Acceptance Test (UAT)", sit: "im System Integration Test (SIT)", release: "wird nach PRD ausgerollt", signoff: "wartet auf Sign-off", development_done: "von Data Product Development abgeschlossen", development_rejected: "von Data Product Development zurückgegeben", done: "abgeschlossen", withdrawn: "zurückgezogen", approved: "genehmigt", rejected: "abgelehnt" },
  pl: { submitted: "złożony", refinement_review: "u Business Analyst / Req. Engineer (doprecyzowanie projektu)", sourcing: "u Business Analyst (dokumentowanie sourcingu)", refinement_ok: "doprecyzowanie zatwierdzone (sourcing udokumentowany)", refinement_rejected: "zwrócony przez Business Analyst",
    owner_review: "oczekuje na zatwierdzenie właściciela danych", owner_approved: "użycie danych zatwierdzone przez właściciela (przekazano do Data Ingestion)", owner_rejected: "odrzucony przez właściciela danych (wraca do Business Analyst)",
    ingestion_review: "u Data Ingestion", ingestion_confirmed: "zaingestowane tabele potwierdzone przez Data Ingestion", ingestion_ok: "zatwierdzony przez Data Ingestion", ingestion_rejected: "zwrócony przez Data Ingestion",
    refine_review: "u Business Analyst do doprecyzowania", refine_ok: "doprecyzowanie zakończone przez Business Analyst", refine_rejected: "zwrócony przez Business Analyst (doprecyzowanie)",
    development: "w rozwoju (Data Product Development)", uat: "w testach akceptacyjnych (UAT)", sit: "w testach integracyjnych (SIT)", release: "wdrażany na PRD", signoff: "oczekuje na podpis", development_done: "zakończony przez Data Product Development", development_rejected: "zwrócony przez Data Product Development", done: "zakończony", withdrawn: "wycofany", approved: "zatwierdzony", rejected: "odrzucony" },
  es: { submitted: "enviado", refinement_review: "con el Business Analyst / Req. Engineer (refinando el diseño)", sourcing: "con el Business Analyst (documentando el sourcing)", refinement_ok: "refinamiento aprobado (sourcing documentado)", refinement_rejected: "devuelto por el Business Analyst",
    owner_review: "esperando la aprobación del propietario de datos", owner_approved: "uso de datos aprobado por el propietario (enviado a Data Ingestion)", owner_rejected: "rechazado por el propietario de datos (de vuelta con el Business Analyst)",
    ingestion_review: "con Data Ingestion", ingestion_confirmed: "tablas ingeridas confirmadas por Data Ingestion", ingestion_ok: "aprobado por Data Ingestion", ingestion_rejected: "devuelto por Data Ingestion",
    refine_review: "con el Business Analyst para refinamiento", refine_ok: "refinamiento completado por el Business Analyst", refine_rejected: "devuelto por el Business Analyst (refinamiento)",
    development: "en desarrollo (Data Product Development)", uat: "en pruebas de aceptación (UAT)", sit: "en pruebas de integración (SIT)", release: "en despliegue a PRD", signoff: "esperando la firma", development_done: "completado por Data Product Development", development_rejected: "devuelto por Data Product Development", done: "terminado", withdrawn: "retirado", approved: "aprobado", rejected: "rechazado" },
  fr: { submitted: "soumis", refinement_review: "chez le Business Analyst / Req. Engineer (affinage du design)", sourcing: "chez le Business Analyst (documentation du sourcing)", refinement_ok: "affinage approuvé (sourcing documenté)", refinement_rejected: "renvoyé par le Business Analyst",
    owner_review: "en attente de l'approbation du propriétaire des données", owner_approved: "usage des données approuvé par le propriétaire (transmis à Data Ingestion)", owner_rejected: "refusé par le propriétaire des données (retour chez le Business Analyst)",
    ingestion_review: "chez Data Ingestion", ingestion_confirmed: "tables ingérées confirmées par Data Ingestion", ingestion_ok: "approuvé par Data Ingestion", ingestion_rejected: "renvoyé par Data Ingestion",
    refine_review: "chez le Business Analyst pour affinage", refine_ok: "affinage terminé par le Business Analyst", refine_rejected: "renvoyé par le Business Analyst (affinage)",
    development: "en développement (Data Product Development)", uat: "en recette utilisateur (UAT)", sit: "en test d'intégration (SIT)", release: "en cours de mise en production", signoff: "en attente de validation finale", development_done: "terminé par Data Product Development", development_rejected: "renvoyé par Data Product Development", done: "terminé", withdrawn: "retiré", approved: "approuvée", rejected: "refusée" },
  it: { submitted: "inviato", refinement_review: "presso il Business Analyst / Req. Engineer (raffinamento del design)", sourcing: "presso il Business Analyst (documentazione del sourcing)", refinement_ok: "raffinamento approvato (sourcing documentato)", refinement_rejected: "restituito dal Business Analyst",
    owner_review: "in attesa dell'approvazione del data owner", owner_approved: "uso dei dati approvato dal data owner (inoltrato a Data Ingestion)", owner_rejected: "rifiutato dal data owner (di nuovo presso il Business Analyst)",
    ingestion_review: "presso Data Ingestion", ingestion_confirmed: "tabelle ingerite confermate da Data Ingestion", ingestion_ok: "approvato da Data Ingestion", ingestion_rejected: "restituito da Data Ingestion",
    refine_review: "presso il Business Analyst per il raffinamento", refine_ok: "raffinamento completato dal Business Analyst", refine_rejected: "restituito dal Business Analyst (raffinamento)",
    development: "in sviluppo (Data Product Development)", uat: "in test di accettazione (UAT)", sit: "in test di integrazione (SIT)", release: "in rilascio su PRD", signoff: "in attesa di approvazione finale", development_done: "completato da Data Product Development", development_rejected: "restituito da Data Product Development", done: "completato", withdrawn: "ritirato", approved: "approvata", rejected: "rifiutata" },
};
export const statusText = (lang, status) => (STATUS_TEXT_L10N[lang] || STATUS_TEXT_L10N.en)[status] || STATUS_TEXT_L10N.en[status] || status;

/* message templates: key → lang → { subject, body } (functions of params) */
const DRIFT_KIND = {
  en: { newTable: "new table", newColumn: "new column", removedTable: "table no longer in Unity Catalog", removedColumn: "column no longer in Unity Catalog", changedType: "type changed" },
  de: { newTable: "neue Tabelle", newColumn: "neue Spalte", removedTable: "Tabelle nicht mehr in Unity Catalog", removedColumn: "Spalte nicht mehr in Unity Catalog", changedType: "Typ geändert" },
  pl: { newTable: "nowa tabela", newColumn: "nowa kolumna", removedTable: "tabeli nie ma już w Unity Catalog", removedColumn: "kolumny nie ma już w Unity Catalog", changedType: "zmieniony typ" },
  es: { newTable: "tabla nueva", newColumn: "columna nueva", removedTable: "tabla ya no está en Unity Catalog", removedColumn: "columna ya no está en Unity Catalog", changedType: "tipo cambiado" },
  fr: { newTable: "nouvelle table", newColumn: "nouvelle colonne", removedTable: "table absente d'Unity Catalog", removedColumn: "colonne absente d'Unity Catalog", changedType: "type modifié" },
  it: { newTable: "nuova tabella", newColumn: "nuova colonna", removedTable: "tabella non più in Unity Catalog", removedColumn: "colonna non più in Unity Catalog", changedType: "tipo cambiato" },
};
const driftLines = (items, l) => items.map((i) => `- ${i.path}: ${(DRIFT_KIND[l] || DRIFT_KIND.en)[i.kind] || i.kind}${i.kind === "changedType" ? ` (${i.from} → ${i.to})` : ""}`).join("\n");

const MSG = {
  describe_attrs_steward: {
    en: (p) => ({ subject: `Please describe the attributes of ${p.path}`, body: `${p.requester} asks you, as data steward of ${p.path}, to add business descriptions to its ${p.n} attributes.${p.note ? `\n\nNote: ${p.note}` : ""}\n\nOpen the table in the catalog to document the attributes.` }),
    de: (p) => ({ subject: `Bitte beschreiben Sie die Attribute von ${p.path}`, body: `${p.requester} bittet Sie als Data Steward von ${p.path}, die ${p.n} Attribute fachlich zu beschreiben.${p.note ? `\n\nHinweis: ${p.note}` : ""}\n\nÖffnen Sie die Tabelle im Katalog, um die Attribute zu dokumentieren.` }),
    pl: (p) => ({ subject: `Prosimy o opisanie atrybutów ${p.path}`, body: `${p.requester} prosi Cię jako stewarda danych ${p.path} o dodanie opisów biznesowych do ${p.n} atrybutów.${p.note ? `\n\nUwaga: ${p.note}` : ""}\n\nOtwórz tabelę w katalogu, aby udokumentować atrybuty.` }),
    es: (p) => ({ subject: `Por favor describa los atributos de ${p.path}`, body: `${p.requester} le pide, como data steward de ${p.path}, que añada descripciones de negocio a sus ${p.n} atributos.${p.note ? `\n\nNota: ${p.note}` : ""}\n\nAbra la tabla en el catálogo para documentar los atributos.` }),
    fr: (p) => ({ subject: `Merci de décrire les attributs de ${p.path}`, body: `${p.requester} vous demande, en tant que data steward de ${p.path}, d'ajouter des descriptions métier à ses ${p.n} attributs.${p.note ? `\n\nRemarque : ${p.note}` : ""}\n\nOuvrez la table dans le catalogue pour documenter les attributs.` }),
    it: (p) => ({ subject: `Si prega di descrivere gli attributi di ${p.path}`, body: `${p.requester} ti chiede, come data steward di ${p.path}, di aggiungere descrizioni di business ai suoi ${p.n} attributi.${p.note ? `\n\nNota: ${p.note}` : ""}\n\nApri la tabella nel catalogo per documentare gli attributi.` }),
  },
  assign_steward_owner: {
    en: (p) => ({ subject: `Please assign a data steward for ${p.path}`, body: `${p.requester} requested business descriptions for the ${p.n} attributes of ${p.path}, but the table has no data steward. As its data owner, please assign a data steward (Edit table, or on the schema/database/domain for inheritance) so the request can be fulfilled.${p.note ? `\n\nNote: ${p.note}` : ""}` }),
    de: (p) => ({ subject: `Bitte benennen Sie einen Data Steward für ${p.path}`, body: `${p.requester} hat fachliche Beschreibungen für die ${p.n} Attribute von ${p.path} angefordert, die Tabelle hat aber keinen Data Steward. Bitte benennen Sie als Data Owner einen Data Steward (Tabelle bearbeiten oder auf Schema/Datenbank/Domäne zur Vererbung), damit die Anfrage erfüllt werden kann.${p.note ? `\n\nHinweis: ${p.note}` : ""}` }),
    pl: (p) => ({ subject: `Prosimy o wyznaczenie stewarda danych dla ${p.path}`, body: `${p.requester} poprosił o opisy biznesowe ${p.n} atrybutów ${p.path}, ale tabela nie ma stewarda danych. Jako właściciel danych wyznacz stewarda (Edytuj tabelę lub na schemacie/bazie/domenie z dziedziczeniem), aby prośbę można było zrealizować.${p.note ? `\n\nUwaga: ${p.note}` : ""}` }),
    es: (p) => ({ subject: `Por favor asigne un data steward para ${p.path}`, body: `${p.requester} solicitó descripciones de negocio para los ${p.n} atributos de ${p.path}, pero la tabla no tiene data steward. Como propietario de datos, asigne un data steward (Editar tabla, o en el esquema/base/dominio para heredar) para que la solicitud pueda atenderse.${p.note ? `\n\nNota: ${p.note}` : ""}` }),
    fr: (p) => ({ subject: `Merci de désigner un data steward pour ${p.path}`, body: `${p.requester} a demandé des descriptions métier pour les ${p.n} attributs de ${p.path}, mais la table n'a pas de data steward. En tant que propriétaire des données, désignez un data steward (Modifier la table, ou sur le schéma/la base/le domaine pour l'héritage) afin que la demande puisse aboutir.${p.note ? `\n\nRemarque : ${p.note}` : ""}` }),
    it: (p) => ({ subject: `Si prega di assegnare un data steward per ${p.path}`, body: `${p.requester} ha richiesto descrizioni di business per i ${p.n} attributi di ${p.path}, ma la tabella non ha un data steward. Come data owner, assegna un data steward (Modifica tabella, oppure su schema/database/dominio per l'ereditarietà) così che la richiesta possa essere evasa.${p.note ? `\n\nNota: ${p.note}` : ""}` }),
  },
  name_owner_admin: {
    en: (p) => ({ subject: `Please name a data owner for ${p.path}`, body: `${p.requester} requested business descriptions for the ${p.n} attributes of ${p.path}, but the table has neither a data steward nor a data owner. Please name a data owner (on the table, schema, database, domain or hub) so a steward can be assigned.${p.note ? `\n\nNote: ${p.note}` : ""}` }),
    de: (p) => ({ subject: `Bitte benennen Sie einen Data Owner für ${p.path}`, body: `${p.requester} hat fachliche Beschreibungen für die ${p.n} Attribute von ${p.path} angefordert, die Tabelle hat aber weder Data Steward noch Data Owner. Bitte benennen Sie einen Data Owner (auf Tabelle, Schema, Datenbank, Domäne oder Hub), damit ein Steward zugeordnet werden kann.${p.note ? `\n\nHinweis: ${p.note}` : ""}` }),
    pl: (p) => ({ subject: `Prosimy o wskazanie właściciela danych dla ${p.path}`, body: `${p.requester} poprosił o opisy biznesowe ${p.n} atrybutów ${p.path}, ale tabela nie ma ani stewarda, ani właściciela danych. Wskaż właściciela danych (na tabeli, schemacie, bazie, domenie lub hubie), aby można było przypisać stewarda.${p.note ? `\n\nUwaga: ${p.note}` : ""}` }),
    es: (p) => ({ subject: `Por favor nombre un propietario de datos para ${p.path}`, body: `${p.requester} solicitó descripciones de negocio para los ${p.n} atributos de ${p.path}, pero la tabla no tiene ni data steward ni propietario. Nombre un propietario de datos (en la tabla, esquema, base, dominio o hub) para poder asignar un steward.${p.note ? `\n\nNota: ${p.note}` : ""}` }),
    fr: (p) => ({ subject: `Merci de nommer un propriétaire des données pour ${p.path}`, body: `${p.requester} a demandé des descriptions métier pour les ${p.n} attributs de ${p.path}, mais la table n'a ni data steward ni propriétaire. Nommez un propriétaire des données (sur la table, le schéma, la base, le domaine ou le hub) afin qu'un steward puisse être désigné.${p.note ? `\n\nRemarque : ${p.note}` : ""}` }),
    it: (p) => ({ subject: `Si prega di nominare un data owner per ${p.path}`, body: `${p.requester} ha richiesto descrizioni di business per i ${p.n} attributi di ${p.path}, ma la tabella non ha né data steward né data owner. Nomina un data owner (su tabella, schema, database, dominio o hub) così che si possa assegnare uno steward.${p.note ? `\n\nNota: ${p.note}` : ""}` }),
  },
  design_submitted: {
    en: (p) => ({ subject: `Data product design "${p.name}" submitted`, body: `Your design "${p.name}" (${p.hub}) is in the request list. It has been forwarded to the Business Analyst for refinement and sourcing.` }),
    de: (p) => ({ subject: `Datenprodukt-Design „${p.name}“ eingereicht`, body: `Ihr Design „${p.name}“ (${p.hub}) steht in der Anfrageliste. Es wurde zur Verfeinerung und zum Sourcing an den Business Analyst weitergeleitet.` }),
    pl: (p) => ({ subject: `Projekt produktu danych „${p.name}” złożony`, body: `Twój projekt „${p.name}” (${p.hub}) jest na liście wniosków. Został przekazany do Business Analyst w celu doprecyzowania i sourcingu.` }),
    es: (p) => ({ subject: `Diseño de producto de datos «${p.name}» enviado`, body: `Su diseño «${p.name}» (${p.hub}) está en la lista de solicitudes. Se ha enviado al Business Analyst para refinamiento y sourcing.` }),
    fr: (p) => ({ subject: `Design de produit de données « ${p.name} » soumis`, body: `Votre design « ${p.name} » (${p.hub}) figure dans la liste des demandes. Il a été transmis au Business Analyst pour affinage et sourcing.` }),
    it: (p) => ({ subject: `Design del prodotto dati "${p.name}" inviato`, body: `Il tuo design "${p.name}" (${p.hub}) è nell'elenco delle richieste. È stato inoltrato al Business Analyst per raffinamento e sourcing.` }),
  },
  design_refine: {
    en: (p) => ({ subject: `Data product design "${p.name}" — please refine`, body: `${p.requester} designed "${p.name}" (${p.hub}). Please refine the design (edit the entries if needed), mark it "Design refined" and document the sourcing.` }),
    de: (p) => ({ subject: `Datenprodukt-Design „${p.name}“ — bitte verfeinern`, body: `${p.requester} hat „${p.name}“ (${p.hub}) designt. Bitte verfeinern Sie das Design (Einträge bei Bedarf bearbeiten), markieren Sie es als „Design verfeinert“ und dokumentieren Sie das Sourcing.` }),
    pl: (p) => ({ subject: `Projekt produktu danych „${p.name}” — prosimy o doprecyzowanie`, body: `${p.requester} zaprojektował „${p.name}” (${p.hub}). Doprecyzuj projekt (w razie potrzeby edytuj wpisy), oznacz „Projekt doprecyzowany” i udokumentuj sourcing.` }),
    es: (p) => ({ subject: `Diseño de producto de datos «${p.name}» — por favor refinar`, body: `${p.requester} diseñó «${p.name}» (${p.hub}). Refine el diseño (edite las entradas si es necesario), márquelo como «Diseño refinado» y documente el sourcing.` }),
    fr: (p) => ({ subject: `Design de produit de données « ${p.name} » — à affiner`, body: `${p.requester} a conçu « ${p.name} » (${p.hub}). Affinez le design (modifiez les entrées si besoin), marquez-le « Design affiné » et documentez le sourcing.` }),
    it: (p) => ({ subject: `Design del prodotto dati "${p.name}" — da raffinare`, body: `${p.requester} ha progettato "${p.name}" (${p.hub}). Raffina il design (modifica le voci se necessario), contrassegnalo come "Design raffinato" e documenta il sourcing.` }),
  },
  access_request: {
    en: (p) => ({ subject: `Access request: ${p.product}`, body: `${p.requester} requests access to ${p.product}.\n\nPurpose: ${p.purpose}` }),
    de: (p) => ({ subject: `Zugriffsanfrage: ${p.product}`, body: `${p.requester} beantragt Zugriff auf ${p.product}.\n\nZweck: ${p.purpose}` }),
    pl: (p) => ({ subject: `Wniosek o dostęp: ${p.product}`, body: `${p.requester} prosi o dostęp do ${p.product}.\n\nCel: ${p.purpose}` }),
    es: (p) => ({ subject: `Solicitud de acceso: ${p.product}`, body: `${p.requester} solicita acceso a ${p.product}.\n\nPropósito: ${p.purpose}` }),
    fr: (p) => ({ subject: `Demande d'accès : ${p.product}`, body: `${p.requester} demande l'accès à ${p.product}.\n\nObjectif : ${p.purpose}` }),
    it: (p) => ({ subject: `Richiesta di accesso: ${p.product}`, body: `${p.requester} richiede l'accesso a ${p.product}.\n\nScopo: ${p.purpose}` }),
  },
  access_decided: {
    en: (p, l) => ({ subject: `Your access request is ${statusText(l, p.status)}`, body: `${p.product}: ${statusText(l, p.status)}${p.reason ? ` — ${p.reason}` : ""}` }),
    de: (p, l) => ({ subject: `Ihre Zugriffsanfrage wurde ${statusText(l, p.status)}`, body: `${p.product}: ${statusText(l, p.status)}${p.reason ? ` — ${p.reason}` : ""}` }),
    pl: (p, l) => ({ subject: `Twój wniosek o dostęp: ${statusText(l, p.status)}`, body: `${p.product}: ${statusText(l, p.status)}${p.reason ? ` — ${p.reason}` : ""}` }),
    es: (p, l) => ({ subject: `Su solicitud de acceso ha sido ${statusText(l, p.status)}`, body: `${p.product}: ${statusText(l, p.status)}${p.reason ? ` — ${p.reason}` : ""}` }),
    fr: (p, l) => ({ subject: `Votre demande d'accès est ${statusText(l, p.status)}`, body: `${p.product} : ${statusText(l, p.status)}${p.reason ? ` — ${p.reason}` : ""}` }),
    it: (p, l) => ({ subject: `La tua richiesta di accesso è stata ${statusText(l, p.status)}`, body: `${p.product}: ${statusText(l, p.status)}${p.reason ? ` — ${p.reason}` : ""}` }),
  },
  design_status: {
    en: (p, l) => ({ subject: `Data product "${p.name}": ${statusText(l, p.status)}`, body: `${p.requester} set the design "${p.name}" (${p.hub}) to "${statusText(l, p.status)}".${reasonLine("Reason", p.reason)}${p.review ? "\n\nPlease review it under Marketplace → All requests." : ""}` }),
    de: (p, l) => ({ subject: `Datenprodukt „${p.name}“: ${statusText(l, p.status)}`, body: `${p.requester} hat das Design „${p.name}“ (${p.hub}) auf „${statusText(l, p.status)}“ gesetzt.${reasonLine("Grund", p.reason)}${p.review ? "\n\nBitte prüfen Sie es unter Marktplatz → Alle Anfragen." : ""}` }),
    pl: (p, l) => ({ subject: `Produkt danych „${p.name}”: ${statusText(l, p.status)}`, body: `${p.requester} ustawił projekt „${p.name}” (${p.hub}) na „${statusText(l, p.status)}”.${reasonLine("Powód", p.reason)}${p.review ? "\n\nSprawdź go w Marketplace → Wszystkie wnioski." : ""}` }),
    es: (p, l) => ({ subject: `Producto de datos «${p.name}»: ${statusText(l, p.status)}`, body: `${p.requester} puso el diseño «${p.name}» (${p.hub}) en «${statusText(l, p.status)}».${reasonLine("Motivo", p.reason)}${p.review ? "\n\nRevíselo en Marketplace → Todas las solicitudes." : ""}` }),
    fr: (p, l) => ({ subject: `Produit de données « ${p.name} » : ${statusText(l, p.status)}`, body: `${p.requester} a passé le design « ${p.name} » (${p.hub}) à « ${statusText(l, p.status)} ».${reasonLine("Motif", p.reason)}${p.review ? "\n\nMerci de l'examiner sous Marketplace → Toutes les demandes." : ""}` }),
    it: (p, l) => ({ subject: `Prodotto dati "${p.name}": ${statusText(l, p.status)}`, body: `${p.requester} ha impostato il design "${p.name}" (${p.hub}) su "${statusText(l, p.status)}".${reasonLine("Motivo", p.reason)}${p.review ? "\n\nVerificalo in Marketplace → Tutte le richieste." : ""}` }),
  },
  stewardship_reminder: {
    en: (p, l) => ({ subject: `Stewardship: ${parts(p.reviews.length && `${count(p.reviews.length, "review", "reviews")} due`, p.attestations.length && `${count(p.attestations.length, "ownership attestation", "ownership attestations")} due`)}`,
      body: [p.reviews.length && `Reviews due (${p.reviews.length}):\n${list(p.reviews, REVIEW_LINE[l], l)}`, p.attestations.length && `Ownership to confirm (${p.attestations.length}):\n${list(p.attestations, ATTEST_LINE[l], l)}`].filter(Boolean).join("\n\n") + "\n\nOpen My Dashboard › Stewardship tasks to mark tables as reviewed or confirm ownership." }),
    de: (p, l) => ({ subject: `Stewardship: ${parts(p.reviews.length && `${count(p.reviews.length, "Review", "Reviews")} fällig`, p.attestations.length && `${count(p.attestations.length, "Ownership-Bestätigung", "Ownership-Bestätigungen")} fällig`)}`,
      body: [p.reviews.length && `Fällige Reviews (${p.reviews.length}):\n${list(p.reviews, REVIEW_LINE[l], l)}`, p.attestations.length && `Zu bestätigende Ownership (${p.attestations.length}):\n${list(p.attestations, ATTEST_LINE[l], l)}`].filter(Boolean).join("\n\n") + "\n\nÖffnen Sie Mein Dashboard › Stewardship-Aufgaben, um Tabellen als geprüft zu markieren oder die Ownership zu bestätigen." }),
    pl: (p, l) => ({ subject: `Stewardship: ${parts(p.reviews.length && `${p.reviews.length} przegląd(y) do wykonania`, p.attestations.length && `${p.attestations.length} potwierdzenie/-a własności`)}`,
      body: [p.reviews.length && `Przeglądy do wykonania (${p.reviews.length}):\n${list(p.reviews, REVIEW_LINE[l], l)}`, p.attestations.length && `Własność do potwierdzenia (${p.attestations.length}):\n${list(p.attestations, ATTEST_LINE[l], l)}`].filter(Boolean).join("\n\n") + "\n\nOtwórz Mój pulpit › Zadania stewardship, aby oznaczyć tabele jako sprawdzone lub potwierdzić własność." }),
    es: (p, l) => ({ subject: `Stewardship: ${parts(p.reviews.length && count(p.reviews.length, "revisión pendiente", "revisiones pendientes"), p.attestations.length && count(p.attestations.length, "atestación de propiedad pendiente", "atestaciones de propiedad pendientes"))}`,
      body: [p.reviews.length && `Revisiones pendientes (${p.reviews.length}):\n${list(p.reviews, REVIEW_LINE[l], l)}`, p.attestations.length && `Propiedad por confirmar (${p.attestations.length}):\n${list(p.attestations, ATTEST_LINE[l], l)}`].filter(Boolean).join("\n\n") + "\n\nAbra Mi panel › Tareas de stewardship para marcar tablas como revisadas o confirmar la propiedad." }),
    fr: (p, l) => ({ subject: `Stewardship : ${parts(p.reviews.length && `${count(p.reviews.length, "revue", "revues")} à faire`, p.attestations.length && `${count(p.attestations.length, "attestation de propriété", "attestations de propriété")} à faire`)}`,
      body: [p.reviews.length && `Revues à faire (${p.reviews.length}) :\n${list(p.reviews, REVIEW_LINE[l], l)}`, p.attestations.length && `Propriété à confirmer (${p.attestations.length}) :\n${list(p.attestations, ATTEST_LINE[l], l)}`].filter(Boolean).join("\n\n") + "\n\nOuvrez Mon tableau de bord › Tâches de stewardship pour marquer les tables comme revues ou confirmer la propriété." }),
    it: (p, l) => ({ subject: `Stewardship: ${parts(p.reviews.length && `${count(p.reviews.length, "revisione", "revisioni")} in scadenza`, p.attestations.length && `${count(p.attestations.length, "attestazione di proprietà", "attestazioni di proprietà")} in scadenza`)}`,
      body: [p.reviews.length && `Revisioni in scadenza (${p.reviews.length}):\n${list(p.reviews, REVIEW_LINE[l], l)}`, p.attestations.length && `Proprietà da confermare (${p.attestations.length}):\n${list(p.attestations, ATTEST_LINE[l], l)}`].filter(Boolean).join("\n\n") + "\n\nApri La mia dashboard › Attività di stewardship per contrassegnare le tabelle come revisionate o confermare la proprietà." }),
  },
  question_asked: {
    en: (p) => ({ subject: `Question about ${p.path}`, body: `${p.asker} asked a question about ${p.path}:\n\n"${p.body}"\n\nYou receive this as its data steward or data owner. Answer it on the Discussion tab of the object; the question is marked as resolved once you resolve it there.` }),
    de: (p) => ({ subject: `Frage zu ${p.path}`, body: `${p.asker} hat eine Frage zu ${p.path} gestellt:\n\n„${p.body}“\n\nSie erhalten diese Nachricht als Data Steward bzw. Data Owner. Beantworten Sie die Frage im Reiter „Diskussion“ des Objekts; dort können Sie sie anschließend als gelöst markieren.` }),
    pl: (p) => ({ subject: `Pytanie dotyczące ${p.path}`, body: `${p.asker} zadał pytanie dotyczące ${p.path}:\n\n„${p.body}”\n\nOtrzymujesz tę wiadomość jako steward lub właściciel danych. Odpowiedz w zakładce „Dyskusja” obiektu; tam możesz też oznaczyć pytanie jako rozwiązane.` }),
    es: (p) => ({ subject: `Pregunta sobre ${p.path}`, body: `${p.asker} hizo una pregunta sobre ${p.path}:\n\n«${p.body}»\n\nRecibe este mensaje como data steward o propietario de datos. Respóndala en la pestaña «Discusión» del objeto; allí podrá marcarla como resuelta.` }),
    fr: (p) => ({ subject: `Question sur ${p.path}`, body: `${p.asker} a posé une question sur ${p.path} :\n\n« ${p.body} »\n\nVous recevez ce message en tant que data steward ou propriétaire des données. Répondez dans l'onglet « Discussion » de l'objet ; vous pourrez ensuite y marquer la question comme résolue.` }),
    it: (p) => ({ subject: `Domanda su ${p.path}`, body: `${p.asker} ha posto una domanda su ${p.path}:\n\n"${p.body}"\n\nRicevi questo messaggio come data steward o data owner. Rispondi nella scheda "Discussione" dell'oggetto; lì potrai poi contrassegnare la domanda come risolta.` }),
  },
  question_answered: {
    en: (p) => ({ subject: `Answer to your question about ${p.path}`, body: `${p.answerer} answered your question about ${p.path}:\n\n"${p.body}"\n\nOpen the Discussion tab of the object to read the whole thread.` }),
    de: (p) => ({ subject: `Antwort auf Ihre Frage zu ${p.path}`, body: `${p.answerer} hat Ihre Frage zu ${p.path} beantwortet:\n\n„${p.body}“\n\nÖffnen Sie den Reiter „Diskussion“ des Objekts, um den gesamten Verlauf zu lesen.` }),
    pl: (p) => ({ subject: `Odpowiedź na Twoje pytanie dotyczące ${p.path}`, body: `${p.answerer} odpowiedział na Twoje pytanie dotyczące ${p.path}:\n\n„${p.body}”\n\nOtwórz zakładkę „Dyskusja” obiektu, aby przeczytać cały wątek.` }),
    es: (p) => ({ subject: `Respuesta a su pregunta sobre ${p.path}`, body: `${p.answerer} respondió a su pregunta sobre ${p.path}:\n\n«${p.body}»\n\nAbra la pestaña «Discusión» del objeto para leer el hilo completo.` }),
    fr: (p) => ({ subject: `Réponse à votre question sur ${p.path}`, body: `${p.answerer} a répondu à votre question sur ${p.path} :\n\n« ${p.body} »\n\nOuvrez l'onglet « Discussion » de l'objet pour lire tout le fil.` }),
    it: (p) => ({ subject: `Risposta alla tua domanda su ${p.path}`, body: `${p.answerer} ha risposto alla tua domanda su ${p.path}:\n\n"${p.body}"\n\nApri la scheda "Discussione" dell'oggetto per leggere l'intera conversazione.` }),
  },
  uc_drift: {
    en: (p, l) => ({ subject: `Unity Catalog drift: ${p.catalog} (${count(p.items.length, "difference", "differences", { plus: !!p.more })})`,
      body: `The scheduled synchronisation "${p.profile}" compared Unity Catalog ${p.catalog} with the catalog${p.mode === "apply" ? " and applied the differences" : " (report only — nothing was changed)"}. Objects you are responsible for:\n\n${driftLines(p.items, l)}${p.more ? `\n… and ${p.more} more` : ""}\n\nOpen the tables in the catalog to review descriptions, sensitivity and lineage of new or changed columns.` }),
    de: (p, l) => ({ subject: `Unity-Catalog-Abweichung: ${p.catalog} (${count(p.items.length, "Unterschied", "Unterschiede", { plus: !!p.more })})`,
      body: `Die geplante Synchronisation „${p.profile}“ hat Unity Catalog ${p.catalog} mit dem Katalog verglichen${p.mode === "apply" ? " und die Unterschiede übernommen" : " (nur Bericht — nichts wurde geändert)"}. Objekte in Ihrer Verantwortung:\n\n${driftLines(p.items, l)}${p.more ? `\n… und ${p.more} weitere` : ""}\n\nÖffnen Sie die Tabellen im Katalog, um Beschreibungen, Sensitivität und Lineage neuer oder geänderter Spalten zu prüfen.` }),
    pl: (p, l) => ({ subject: `Rozbieżność Unity Catalog: ${p.catalog} (${p.items.length}${p.more ? "+" : ""} różnic)`,
      body: `Zaplanowana synchronizacja „${p.profile}” porównała Unity Catalog ${p.catalog} z katalogiem${p.mode === "apply" ? " i zastosowała różnice" : " (tylko raport — nic nie zmieniono)"}. Obiekty, za które odpowiadasz:\n\n${driftLines(p.items, l)}${p.more ? `\n… i ${p.more} więcej` : ""}\n\nOtwórz tabele w katalogu, aby sprawdzić opisy, wrażliwość i lineage nowych lub zmienionych kolumn.` }),
    es: (p, l) => ({ subject: `Desviación de Unity Catalog: ${p.catalog} (${count(p.items.length, "diferencia", "diferencias", { plus: !!p.more })})`,
      body: `La sincronización programada «${p.profile}» comparó Unity Catalog ${p.catalog} con el catálogo${p.mode === "apply" ? " y aplicó las diferencias" : " (solo informe — no se cambió nada)"}. Objetos bajo su responsabilidad:\n\n${driftLines(p.items, l)}${p.more ? `\n… y ${p.more} más` : ""}\n\nAbra las tablas en el catálogo para revisar descripciones, sensibilidad y linaje de las columnas nuevas o modificadas.` }),
    fr: (p, l) => ({ subject: `Écart Unity Catalog : ${p.catalog} (${count(p.items.length, "différence", "différences", { plus: !!p.more })})`,
      body: `La synchronisation planifiée « ${p.profile} » a comparé Unity Catalog ${p.catalog} avec le catalogue${p.mode === "apply" ? " et appliqué les différences" : " (rapport seul — rien n'a été modifié)"}. Objets sous votre responsabilité :\n\n${driftLines(p.items, l)}${p.more ? `\n… et ${p.more} de plus` : ""}\n\nOuvrez les tables dans le catalogue pour vérifier descriptions, sensibilité et lignage des colonnes nouvelles ou modifiées.` }),
    it: (p, l) => ({ subject: `Scostamento Unity Catalog: ${p.catalog} (${count(p.items.length, "differenza", "differenze", { plus: !!p.more })})`,
      body: `La sincronizzazione pianificata "${p.profile}" ha confrontato Unity Catalog ${p.catalog} con il catalogo${p.mode === "apply" ? " e applicato le differenze" : " (solo report — nulla è stato modificato)"}. Oggetti di tua responsabilità:\n\n${driftLines(p.items, l)}${p.more ? `\n… e altri ${p.more}` : ""}\n\nApri le tabelle nel catalogo per verificare descrizioni, sensibilità e lineage delle colonne nuove o modificate.` }),
  },
};

export const renderMessage = (key, lang, params) => {
  const tpl = MSG[key];
  if (!tpl) throw new Error(`unknown message key ${key}`);
  const l = UI_LANGS.includes(lang) && tpl[lang] ? lang : "en";
  return tpl[l](params, l);
};

/* languages of accounts by e-mail (EN when unknown) */
export const langsOf = async (emails) => {
  const uniq = [...new Set(emails.filter(Boolean).map((e) => String(e).toLowerCase()))];
  if (!uniq.length) return {};
  const rows = await q(`SELECT email, lang FROM users WHERE email IN (${uniq.map(() => "?").join(",")})`, uniq);
  const out = Object.fromEntries(uniq.map((e) => [e, "en"]));
  for (const r of rows) out[String(r.email).toLowerCase()] = UI_LANGS.includes(r.lang) ? r.lang : "en";
  return out;
};
