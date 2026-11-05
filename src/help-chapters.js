/* Help v2 (v1.62): the (i) help is organised in chapters — a role-based guide first, then feature chapters that reuse the
   per-feature texts of help-content.js (same section order in all six languages, composed by index). Body format as in
   help-content.js: blank line = paragraph, "• " = bullet, "1. " = numbered step, ```…``` = code, **x** = bold. */
import { HELP } from "./help-content.js";
import { manualFor } from "./help-manual.js";

/* feature chapters: which help-content sections (by index) belong where; `adminOnly` hides the chapter for non-admins */
export const CHAPTERS = [
  { id: "start", icon: "boxes", sections: [29, 1, 15, 17, 11, 8] },
  { id: "roles", icon: "users", sections: [] },
  { id: "catalog", icon: "pencil", sections: [0, 2, 9, 13, 4, 16] },
  { id: "governance", icon: "shield", sections: [3, 18, 22, 24, 7] },
  { id: "products", icon: "store", sections: [10, 12, 14] },
  { id: "data", icon: "upload", sections: [5, 6, 21, 28] },
  { id: "agents", icon: "bot", sections: [19, 20, 25] },
  { id: "admin", icon: "usercog", sections: [30, 23, 26, 27], adminOnly: true },
];
export const ROLE_IDS = ["guest", "steward", "owner", "pm", "ba", "ingestion", "dpd", "admin", "agent"];

/* chapter titles and intros */
const CH = {
  en: {
    start: ["Getting started", "Signing in, finding your way around, searching, your personal dashboard, messages and your account."],
    roles: ["Guides by role", "What each role sees and may do, and how its typical tasks run step by step. Pick your role — your account roles are preselected."],
    catalog: ["Catalog & metadata", "How the catalog is structured and how objects, glossary terms, tags and lineage are maintained."],
    governance: ["Governance & stewardship", "Owners, stewards, permissions, certification and reviews, discussion and audit trail."],
    products: ["Data products & marketplace", "Requesting access, designing a data product and following it through the three phases."],
    data: ["Import & export", "Everything that brings metadata into the catalog or takes it out: Unity Catalog, source systems, CSV, OKF, dumps."],
    agents: ["AI agents & MCP", "Connecting Claude and other MCP clients, what they can read and change, OAuth and agent keys."],
    admin: ["Administration", "Users, backups, identity, operation — the Admin menu and everything behind it."],
  },
  de: {
    start: ["Erste Schritte", "Anmelden, sich zurechtfinden, suchen, das persönliche Dashboard, Nachrichten und das eigene Konto."],
    roles: ["Anleitungen nach Rolle", "Was jede Rolle sieht und darf, und wie ihre typischen Aufgaben Schritt für Schritt ablaufen. Wähle deine Rolle — deine Kontorollen sind vorausgewählt."],
    catalog: ["Katalog & Metadaten", "Wie der Katalog aufgebaut ist und wie Objekte, Glossarbegriffe, Tags und Lineage gepflegt werden."],
    governance: ["Governance & Stewardship", "Owner, Stewards, Berechtigungen, Zertifizierung und Reviews, Diskussion und Audit-Trail."],
    products: ["Datenprodukte & Marktplatz", "Zugriff anfordern, ein Datenprodukt entwerfen und es durch die drei Phasen begleiten."],
    data: ["Import & Export", "Alles, was Metadaten in den Katalog bringt oder herausführt: Unity Catalog, Quellsysteme, CSV, OKF, Dumps."],
    agents: ["KI-Agenten & MCP", "Claude und andere MCP-Clients anbinden, was sie lesen und ändern dürfen, OAuth und Agent-Schlüssel."],
    admin: ["Administration", "Benutzer, Backups, Identität, Betrieb — das Admin-Menü und alles dahinter."],
  },
  pl: {
    start: ["Pierwsze kroki", "Logowanie, orientacja, wyszukiwanie, osobisty pulpit, wiadomości i własne konto."],
    roles: ["Przewodniki według roli", "Co każda rola widzi i może, oraz jak krok po kroku przebiegają jej typowe zadania. Wybierz swoją rolę — role konta są zaznaczone."],
    catalog: ["Katalog i metadane", "Jak zbudowany jest katalog i jak utrzymuje się obiekty, pojęcia słownika, tagi i lineage."],
    governance: ["Governance i stewardship", "Właściciele, stewardzi, uprawnienia, certyfikacja i przeglądy, dyskusja i dziennik audytu."],
    products: ["Produkty danych i marketplace", "Wnioskowanie o dostęp, projektowanie produktu danych i prowadzenie go przez trzy fazy."],
    data: ["Import i eksport", "Wszystko, co wprowadza metadane do katalogu lub je wyprowadza: Unity Catalog, systemy źródłowe, CSV, OKF, zrzuty."],
    agents: ["Agenci AI i MCP", "Podłączanie Claude i innych klientów MCP, co mogą czytać i zmieniać, OAuth i klucze agentów."],
    admin: ["Administracja", "Użytkownicy, kopie zapasowe, tożsamość, eksploatacja — menu Admin i wszystko za nim."],
  },
  es: {
    start: ["Primeros pasos", "Iniciar sesión, orientarse, buscar, el panel personal, los mensajes y la propia cuenta."],
    roles: ["Guías por rol", "Qué ve y puede hacer cada rol, y cómo se desarrollan sus tareas típicas paso a paso. Elige tu rol — los roles de tu cuenta están preseleccionados."],
    catalog: ["Catálogo y metadatos", "Cómo se estructura el catálogo y cómo se mantienen objetos, términos del glosario, etiquetas y linaje."],
    governance: ["Gobernanza y stewardship", "Propietarios, stewards, permisos, certificación y revisiones, discusión y auditoría."],
    products: ["Productos de datos y marketplace", "Solicitar acceso, diseñar un producto de datos y acompañarlo por las tres fases."],
    data: ["Importar y exportar", "Todo lo que introduce metadatos en el catálogo o los saca: Unity Catalog, sistemas fuente, CSV, OKF, volcados."],
    agents: ["Agentes de IA y MCP", "Conectar Claude y otros clientes MCP, qué pueden leer y cambiar, OAuth y claves de agente."],
    admin: ["Administración", "Usuarios, copias de seguridad, identidad, operación — el menú Admin y todo lo que hay detrás."],
  },
  fr: {
    start: ["Premiers pas", "Se connecter, s'orienter, rechercher, le tableau de bord personnel, les messages et son compte."],
    roles: ["Guides par rôle", "Ce que chaque rôle voit et peut faire, et comment ses tâches typiques se déroulent pas à pas. Choisissez votre rôle — les rôles de votre compte sont présélectionnés."],
    catalog: ["Catalogue et métadonnées", "Comment le catalogue est structuré et comment les objets, termes du glossaire, tags et lignage sont maintenus."],
    governance: ["Gouvernance et stewardship", "Propriétaires, stewards, permissions, certification et revues, discussion et journal d'audit."],
    products: ["Produits de données et marketplace", "Demander un accès, concevoir un produit de données et le suivre à travers les trois phases."],
    data: ["Import et export", "Tout ce qui fait entrer des métadonnées dans le catalogue ou les en fait sortir : Unity Catalog, systèmes sources, CSV, OKF, dumps."],
    agents: ["Agents IA et MCP", "Connecter Claude et d'autres clients MCP, ce qu'ils peuvent lire et modifier, OAuth et clés d'agent."],
    admin: ["Administration", "Utilisateurs, sauvegardes, identité, exploitation — le menu Admin et tout ce qui se trouve derrière."],
  },
  it: {
    start: ["Primi passi", "Accedere, orientarsi, cercare, la dashboard personale, i messaggi e il proprio account."],
    roles: ["Guide per ruolo", "Cosa vede e può fare ogni ruolo, e come si svolgono passo per passo i suoi compiti tipici. Scegli il tuo ruolo — i ruoli del tuo account sono preselezionati."],
    catalog: ["Catalogo e metadati", "Come è strutturato il catalogo e come si mantengono oggetti, termini del glossario, tag e lineage."],
    governance: ["Governance e stewardship", "Owner, steward, permessi, certificazione e revisioni, discussione e audit trail."],
    products: ["Prodotti dati e marketplace", "Richiedere l'accesso, progettare un prodotto dati e accompagnarlo attraverso le tre fasi."],
    data: ["Import ed export", "Tutto ciò che porta metadati nel catalogo o li esporta: Unity Catalog, sistemi sorgente, CSV, OKF, dump."],
    agents: ["Agenti AI e MCP", "Collegare Claude e altri client MCP, cosa possono leggere e modificare, OAuth e chiavi agente."],
    admin: ["Amministrazione", "Utenti, backup, identità, esercizio — il menu Admin e tutto ciò che c'è dietro."],
  },
};

/* role guides: [title, body] per role and language */
const ROLES = {
  en: {
    guest: ["Guest — reading and requesting", `**What you see:** the whole catalog read-only — data hub types, databases, schemas, tables with attributes, glossary, lineage, governance pages, the Marketplace and your own dashboard. Edit buttons are hidden.

**Typical tasks**
1. **Find data:** type a term into the search box (names, descriptions, business terms, tags, stewards are searched) or expand the tree on the left.
2. **Understand a table:** open it — the tabs show attributes, governance (owner, steward, domain, certification), lineage and the discussion.
3. **Request access to a data product:** on a gold schema click **Request access**, state the purpose, submit. Admins decide; the answer arrives under My Dashboard.
4. **Ask a question:** on the Discussion tab post a question — steward and owner are notified and answer there.
5. **Rate a table** with the stars in the header, so others see which data is trusted.`],
    steward: ["Data Steward — maintaining metadata", `**What you may do:** create, edit and delete tables and attributes in the schemas where you are the effective steward (set on the table, schema, database, domain or data hub); maintain descriptions, business definitions, sensitivity, classification, business terms and tags; create glossary terms; add lineage between tables you are responsible for; certify and review tables.

**Typical tasks**
1. **Describe a table:** open it, **Edit**, fill description, business definition, data owner / steward overrides, tags; save. Attributes are edited inline on the Attributes tab (type, nullable, key, sensitivity, business term).
2. **Certify or review:** Governance tab › **Endorse** (trusted, counts as a review), **Mark as reviewed**, set a **review cycle**, or **Deprecate** with a successor table.
3. **Answer questions:** My Dashboard lists open questions on your tables; answering notifies the asker.
4. **Keep stewardship tasks green:** My Dashboard › Stewardship tasks shows due reviews with one-click actions; reminders arrive once a day.
5. **Load metadata:** use Import › Unity Catalog (or a source system) rather than typing — existing descriptions are kept, new tables and columns are added.`],
    owner: ["Data Owner / BPO — accountable for the data", `Owners are assigned as people (BPO on the data hub, owner on domain, database, schema or table) and matched to your account by e-mail. Ownership is inherited downwards and can be overridden on every level.

**What you may do:** everything a steward may on your assets, plus naming the data steward for them, confirming ownership and approving the use of your data in the data product workflow.

**Typical tasks**
1. **Approve data use (phase 1 · Data Sourcing):** a design that names your BPO area arrives under My Dashboard › Waiting for my action. Open it, check purpose, project and tables, attach the confirming document and **Approve** — or decline with a reason, which sends it back to the analyst.
2. **Confirm ownership:** Governance tab › **Confirm ownership** on the assets where you are set explicitly (policy default: every 180 days); overdue attestations appear under Stewardship tasks.
3. **Assign a steward:** Edit the database, schema or table and set the steward — everything below inherits it.
4. **Decide access requests** to your data products together with the admins (both are notified).`],
    pm: ["Project Manager — designing data products", `**What you may do:** read everything, request access, design new data products, follow all designs and products on the **Discover Data Products** page, and give the final sign-off on designs you submitted. No catalog edits.

**Typical tasks**
1. **Design a data product:** Marketplace › **Design a new data product**: name, description, data hub type, project and use case (both required — they become the tags Project and Use Case), optionally refresh frequency, classification, historization, needed-by date; tick the SOURCE tables that feed it; **Submit**. The design goes to the Business Analyst automatically and the source tables receive the tags.
2. **Follow progress:** Discover Data Products shows phase, exact status and whose action is awaited; the expanded request shows every step as a circle (green done, blue current).
3. **Sign off:** after Released to PRD the design returns to you — **Sign-off** completes it; the finished product gets the Data Product, Project and Use Case tags.
4. **Withdraw** a design that is no longer needed (its tags are removed from the source tables).`],
    ba: ["Business Analyst / Requirements Engineer — sourcing and refinement", `**What you may do:** read everything, act in phases 1 and 2 of the data product workflow (you may edit the design entries while refining), request access. No catalog edits.

**Typical tasks**
1. **Refine the design (phase 1):** a submitted design appears under My Dashboard › Waiting for my action. Open it, sharpen the entries, **Design refined** (notes required, files optional).
2. **Document the sourcing:** enter source system, BPO, LeanIX link and data steward; **Submit and request approval** sends it to the BPO. If the BPO declines, it comes back to you with the reason.
3. **Refine the data product (phase 2):** after Data Ingestion confirmed the tables, complete the refinement with notes (e.g. where it is documented) and attachments — **Refinement completed** forwards it to Development; **Return** sends it back.
4. **Keep the glossary current:** anyone with a responsibility may create business terms and link them to tables and attributes.`],
    ingestion: ["Data Ingestion — bringing the tables in", `**What you may do:** read everything, act in the ingestion step of phase 1, request access. No catalog edits.

**Typical tasks**
1. **Pick up the design:** after the BPO approved the data use it appears under My Dashboard › Waiting for my action.
2. **Ingest and confirm:** load the tables into the agreed layer, then **Confirm ingestion** with the location of the ingested tables (required) — the design moves to refinement automatically. **Return** sends it back to the analyst with a note.
3. **Register the tables in the catalog** (together with a steward or admin): Import › Unity Catalog loads the new schemas and tables; a scheduled sync keeps them current.`],
    dpd: ["Development & Test — building and releasing", `**What you may do:** read everything, act in phase 3 of the data product workflow, request access. No catalog edits.

**Typical tasks**
1. **Development:** the refined design appears under My Dashboard › Waiting for my action. Confirm **Development** with notes on the result (files optional).
2. **UAT and SIT:** confirm **UAT** and **SIT** one after the other; at any step **Return** sends the design back with a reason.
3. **Release:** record **Released to PRD** — the Project Manager who submitted the design is notified and gives the final sign-off.
4. **Document lineage:** ask the steward or admin to add lineage from the source tables to the new gold tables so consumers see where the data comes from.`],
    admin: ["Admin — everything, including structure and users", `**What you may do:** everything — create data hub types, data hubs, domains, databases and schemas; set BPOs, owners and stewards; invite users and assign roles; approve access requests; delete workflow requests; restore history; import, export, dump and restore the whole catalog; run backups and jobs; configure SSO, group mapping, agents and MCP clients.

**Typical tasks**
1. **Set up the structure:** Dashboard › New data hub type, then data hubs (with BPO and country), databases (with domain and medallion layer), schemas — or load everything with Import › Unity Catalog / Load source.
2. **Onboard people:** Admin › Users › Invite — e-mail, name, roles; with SSO or header sign-in accounts appear on first sign-in and the group → role mapping assigns roles.
3. **Decide access requests:** Marketplace or My Dashboard — approve or reject; the requester is notified.
4. **Operate:** Admin › Backups & jobs (schedule, restore drill, sync profiles), Audit trail, Dump/Restore. Check /healthz after every deployment.
5. **Connect agents:** Admin › Users › Invite agent (key with read or write scope) or let MCP clients use OAuth; see the chapter AI agents & MCP.`],
    agent: ["AI agents (MCP) — reading and changing the catalog programmatically", `Agents are technical accounts without a governance role. They talk to **POST /mcp** (JSON-RPC 2.0, Model Context Protocol) with an agent key issued by an admin, an OAuth 2.1 token obtained as a human user, or — behind an authenticating proxy — the forwarded identity of the caller.

**Typical tasks**
1. **Read:** get_overview, list_hubs/databases/schemas/tables, get_table (attributes, governance, rating, open questions, usage), search_catalog, get_lineage, list_glossary_terms; the whole catalog is also available as OKF Markdown via resources/read (okf://…) and export_okf.
2. **Write (write scope, admin/steward for OAuth):** create_* / update_* / delete_* for hubs, databases, schemas, tables, attributes, glossary terms; add_lineage; certify_table, review_table; add_comment. Every change is audited under the agent's or the human's name and uses the same guards as the UI.
3. **Stay within limits:** per-credential rate limits answer 429 with Retry-After; the server returns readable error texts for guard violations.`],
  },
  de: {
    guest: ["Gast — lesen und anfordern", `**Was du siehst:** den gesamten Katalog lesend — Data Hub Types, Datenbanken, Schemata, Tabellen mit Attributen, Glossar, Lineage, Governance-Seiten, den Marktplatz und dein eigenes Dashboard. Bearbeiten-Schaltflächen sind ausgeblendet.

**Typische Aufgaben**
1. **Daten finden:** einen Begriff ins Suchfeld tippen (durchsucht werden Namen, Beschreibungen, Fachbegriffe, Tags, Stewards) oder den Baum links aufklappen.
2. **Eine Tabelle verstehen:** öffnen — die Reiter zeigen Attribute, Governance (Owner, Steward, Domäne, Zertifizierung), Lineage und die Diskussion.
3. **Zugriff auf ein Datenprodukt anfordern:** auf einem Gold-Schema **Zugriff anfordern** klicken, Zweck angeben, absenden. Admins entscheiden; die Antwort kommt unter „Mein Dashboard“ an.
4. **Eine Frage stellen:** im Reiter Diskussion eine Frage posten — Steward und Owner werden benachrichtigt und antworten dort.
5. **Eine Tabelle bewerten** mit den Sternen in der Kopfzeile, damit andere sehen, welchen Daten vertraut wird.`],
    steward: ["Data Steward — Metadaten pflegen", `**Was du darfst:** Tabellen und Attribute in den Schemata anlegen, bearbeiten und löschen, für die du effektiver Steward bist (gesetzt an Tabelle, Schema, Datenbank, Domäne oder Data Hub); Beschreibungen, fachliche Definitionen, Sensitivität, Klassifizierung, Fachbegriffe und Tags pflegen; Glossarbegriffe anlegen; Lineage zwischen Tabellen in deiner Verantwortung eintragen; Tabellen zertifizieren und reviewen.

**Typische Aufgaben**
1. **Eine Tabelle beschreiben:** öffnen, **Bearbeiten**, Beschreibung, fachliche Definition, abweichende Owner/Stewards, Tags ausfüllen; speichern. Attribute werden im Reiter Attribute direkt bearbeitet (Typ, Nullbarkeit, Schlüssel, Sensitivität, Fachbegriff).
2. **Zertifizieren oder reviewen:** Reiter Governance › **Endorsen** (vertrauenswürdig, zählt als Review), **Als geprüft markieren**, **Review-Zyklus** setzen oder **Deprecaten** mit Nachfolgetabelle.
3. **Fragen beantworten:** „Mein Dashboard“ listet offene Fragen zu deinen Tabellen; eine Antwort benachrichtigt den Fragenden.
4. **Stewardship-Aufgaben im Griff behalten:** Mein Dashboard › Stewardship-Aufgaben zeigt fällige Reviews mit Ein-Klick-Aktionen; Erinnerungen kommen einmal täglich.
5. **Metadaten laden:** Import › Unity Catalog (oder ein Quellsystem) statt abtippen — vorhandene Beschreibungen bleiben erhalten, neue Tabellen und Spalten kommen hinzu.`],
    owner: ["Data Owner / BPO — verantwortlich für die Daten", `Owner werden als Personen zugewiesen (BPO am Data Hub, Owner an Domäne, Datenbank, Schema oder Tabelle) und per E-Mail deinem Konto zugeordnet. Ownership vererbt sich nach unten und kann auf jeder Ebene überschrieben werden.

**Was du darfst:** alles, was ein Steward auf deinen Assets darf, zusätzlich den Data Steward dafür benennen, Ownership bestätigen und die Nutzung deiner Daten im Datenprodukt-Workflow freigeben.

**Typische Aufgaben**
1. **Datennutzung freigeben (Phase 1 · Data Sourcing):** ein Entwurf, der deinen BPO-Bereich nennt, erscheint unter Mein Dashboard › Wartet auf meine Aktion. Öffnen, Zweck, Projekt und Tabellen prüfen, das bestätigende Dokument anhängen und **Freigeben** — oder mit Begründung ablehnen, dann geht er zurück an den Analysten.
2. **Ownership bestätigen:** Reiter Governance › **Ownership bestätigen** auf den Assets, an denen du explizit gesetzt bist (Richtlinie: standardmäßig alle 180 Tage); überfällige Bestätigungen erscheinen unter Stewardship-Aufgaben.
3. **Einen Steward benennen:** Datenbank, Schema oder Tabelle bearbeiten und den Steward setzen — alles darunter erbt ihn.
4. **Zugriffsanfragen** auf deine Datenprodukte gemeinsam mit den Admins entscheiden (beide werden benachrichtigt).`],
    pm: ["Projektmanager — Datenprodukte entwerfen", `**Was du darfst:** alles lesen, Zugriff anfordern, neue Datenprodukte entwerfen, alle Entwürfe und Produkte auf der Seite **Datenprodukte entdecken** verfolgen und den abschließenden Sign-off für eingereichte Entwürfe geben. Keine Katalogänderungen.

**Typische Aufgaben**
1. **Ein Datenprodukt entwerfen:** Marktplatz › **Neues Datenprodukt entwerfen**: Name, Beschreibung, Data Hub Type, Projekt und Use Case (beide Pflicht — sie werden zu den Tags Project und Use Case), optional Aktualisierungsfrequenz, Klassifizierung, Historisierung, Bedarfstermin; die SOURCE-Tabellen ankreuzen, die es speisen; **Einreichen**. Der Entwurf geht automatisch an den Business Analyst, die Quelltabellen erhalten die Tags.
2. **Fortschritt verfolgen:** „Datenprodukte entdecken“ zeigt Phase, genauen Status und wessen Aktion erwartet wird; der aufgeklappte Antrag zeigt jeden Schritt als Kreis (grün erledigt, blau aktuell).
3. **Sign-off:** nach „Released to PRD“ kommt der Entwurf zu dir zurück — **Sign-off** schließt ihn ab; das fertige Produkt bekommt die Tags Data Product, Project und Use Case.
4. **Zurückziehen**, wenn ein Entwurf nicht mehr gebraucht wird (die Tags werden von den Quelltabellen entfernt).`],
    ba: ["Business Analyst / Requirements Engineer — Sourcing und Refinement", `**Was du darfst:** alles lesen, in den Phasen 1 und 2 des Datenprodukt-Workflows handeln (beim Verfeinern darfst du die Entwurfseinträge bearbeiten), Zugriff anfordern. Keine Katalogänderungen.

**Typische Aufgaben**
1. **Den Entwurf verfeinern (Phase 1):** ein eingereichter Entwurf erscheint unter Mein Dashboard › Wartet auf meine Aktion. Öffnen, Einträge schärfen, **Design verfeinert** (Notiz Pflicht, Dateien optional).
2. **Das Sourcing dokumentieren:** Quellsystem, BPO, LeanIX-Link und Data Steward eintragen; **Einreichen und Freigabe anfordern** schickt ihn an den BPO. Lehnt der BPO ab, kommt er mit Begründung zu dir zurück.
3. **Das Datenprodukt verfeinern (Phase 2):** nachdem Data Ingestion die Tabellen bestätigt hat, das Refinement mit Notizen (z. B. wo es dokumentiert ist) und Anhängen abschließen — **Refinement abgeschlossen** gibt es an Development weiter; **Zurückgeben** schickt es zurück.
4. **Das Glossar aktuell halten:** jeder mit einer Verantwortung darf Fachbegriffe anlegen und mit Tabellen und Attributen verknüpfen.`],
    ingestion: ["Data Ingestion — die Tabellen hereinholen", `**Was du darfst:** alles lesen, im Ingestion-Schritt der Phase 1 handeln, Zugriff anfordern. Keine Katalogänderungen.

**Typische Aufgaben**
1. **Den Entwurf übernehmen:** nachdem der BPO die Datennutzung freigegeben hat, erscheint er unter Mein Dashboard › Wartet auf meine Aktion.
2. **Laden und bestätigen:** die Tabellen in die vereinbarte Schicht laden, dann **Ingestion bestätigen** mit dem Ablageort der geladenen Tabellen (Pflicht) — der Entwurf geht automatisch ins Refinement. **Zurückgeben** schickt ihn mit Notiz an den Analysten.
3. **Die Tabellen im Katalog registrieren** (mit einem Steward oder Admin): Import › Unity Catalog lädt die neuen Schemata und Tabellen; eine geplante Synchronisation hält sie aktuell.`],
    dpd: ["Development & Test — bauen und releasen", `**Was du darfst:** alles lesen, in Phase 3 des Datenprodukt-Workflows handeln, Zugriff anfordern. Keine Katalogänderungen.

**Typische Aufgaben**
1. **Development:** der verfeinerte Entwurf erscheint unter Mein Dashboard › Wartet auf meine Aktion. **Development** mit Notizen zum Ergebnis bestätigen (Dateien optional).
2. **UAT und SIT:** **UAT** und **SIT** nacheinander bestätigen; bei jedem Schritt schickt **Zurückgeben** den Entwurf mit Begründung zurück.
3. **Release:** **Released to PRD** eintragen — der Projektmanager, der den Entwurf eingereicht hat, wird benachrichtigt und gibt den abschließenden Sign-off.
4. **Lineage dokumentieren:** den Steward oder Admin bitten, Lineage von den Quelltabellen zu den neuen Gold-Tabellen einzutragen, damit Konsumenten sehen, woher die Daten kommen.`],
    admin: ["Admin — alles, inklusive Struktur und Benutzer", `**Was du darfst:** alles — Data Hub Types, Data Hubs, Domänen, Datenbanken und Schemata anlegen; BPOs, Owner und Stewards setzen; Benutzer einladen und Rollen vergeben; Zugriffsanfragen entscheiden; Workflow-Anträge löschen; Historie wiederherstellen; den ganzen Katalog importieren, exportieren, dumpen und wiederherstellen; Backups und Jobs fahren; SSO, Gruppenzuordnung, Agenten und MCP-Clients konfigurieren.

**Typische Aufgaben**
1. **Die Struktur aufbauen:** Dashboard › Neuer Data Hub Type, dann Data Hubs (mit BPO und Land), Datenbanken (mit Domäne und Medallion-Layer), Schemata — oder alles über Import › Unity Catalog / Quelle laden holen.
2. **Personen onboarden:** Admin › Benutzer › Einladen — E-Mail, Name, Rollen; mit SSO oder Header-Anmeldung entstehen Konten beim ersten Aufruf und die Gruppen → Rollen-Zuordnung vergibt die Rollen.
3. **Zugriffsanfragen entscheiden:** Marktplatz oder Mein Dashboard — freigeben oder ablehnen; der Antragsteller wird benachrichtigt.
4. **Betreiben:** Admin › Backups & Jobs (Zeitplan, Restore-Drill, Sync-Profile), Audit-Trail, Dump/Wiederherstellen. Nach jedem Deployment /healthz prüfen.
5. **Agenten anbinden:** Admin › Benutzer › Agent einladen (Schlüssel mit Lese- oder Schreibumfang) oder MCP-Clients OAuth nutzen lassen; siehe Kapitel KI-Agenten & MCP.`],
    agent: ["KI-Agenten (MCP) — den Katalog programmatisch lesen und ändern", `Agenten sind technische Konten ohne Governance-Rolle. Sie sprechen **POST /mcp** (JSON-RPC 2.0, Model Context Protocol) mit einem vom Admin ausgestellten Agent-Schlüssel, einem als Mensch erworbenen OAuth-2.1-Token oder — hinter einem authentifizierenden Proxy — der weitergereichten Identität des Aufrufers.

**Typische Aufgaben**
1. **Lesen:** get_overview, list_hubs/databases/schemas/tables, get_table (Attribute, Governance, Bewertung, offene Fragen, Nutzung), search_catalog, get_lineage, list_glossary_terms; der ganze Katalog steht außerdem als OKF-Markdown über resources/read (okf://…) und export_okf bereit.
2. **Schreiben (Schreibumfang, bei OAuth Admin/Steward):** create_* / update_* / delete_* für Hubs, Datenbanken, Schemata, Tabellen, Attribute, Glossarbegriffe; add_lineage; certify_table, review_table; add_comment. Jede Änderung wird unter dem Namen des Agenten bzw. des Menschen auditiert und nutzt dieselben Prüfungen wie die Oberfläche.
3. **Grenzen einhalten:** Rate-Limits pro Credential antworten mit 429 und Retry-After; der Server liefert lesbare Fehlertexte bei Verstößen gegen Prüfregeln.`],
  },
  pl: {
    guest: ["Gość — czytanie i wnioskowanie", `**Co widzisz:** cały katalog tylko do odczytu — typy hubów, bazy, schematy, tabele z atrybutami, słownik, lineage, strony governance, Marketplace i własny pulpit. Przyciski edycji są ukryte.

**Typowe zadania**
1. **Znajdź dane:** wpisz pojęcie w polu wyszukiwania (przeszukiwane są nazwy, opisy, pojęcia biznesowe, tagi, stewardzi) lub rozwiń drzewo po lewej.
2. **Zrozum tabelę:** otwórz ją — zakładki pokazują atrybuty, governance (właściciel, steward, domena, certyfikacja), lineage i dyskusję.
3. **Poproś o dostęp do produktu danych:** na schemacie gold kliknij **Poproś o dostęp**, podaj cel, wyślij. Decydują admini; odpowiedź pojawia się w Moim pulpicie.
4. **Zadaj pytanie:** w zakładce Dyskusja opublikuj pytanie — steward i właściciel zostaną powiadomieni i odpowiedzą tam.
5. **Oceń tabelę** gwiazdkami w nagłówku, aby inni widzieli, którym danym się ufa.`],
    steward: ["Steward danych — utrzymanie metadanych", `**Co możesz:** tworzyć, edytować i usuwać tabele i atrybuty w schematach, dla których jesteś efektywnym stewardem (ustawionym na tabeli, schemacie, bazie, domenie lub hubie); utrzymywać opisy, definicje biznesowe, wrażliwość, klasyfikację, pojęcia biznesowe i tagi; tworzyć pojęcia słownika; dodawać lineage między tabelami w swojej odpowiedzialności; certyfikować i przeglądać tabele.

**Typowe zadania**
1. **Opisz tabelę:** otwórz, **Edytuj**, wypełnij opis, definicję biznesową, nadpisania właściciela/stewarda, tagi; zapisz. Atrybuty edytujesz bezpośrednio w zakładce Atrybuty (typ, nullowalność, klucz, wrażliwość, pojęcie biznesowe).
2. **Certyfikuj lub przejrzyj:** zakładka Governance › **Rekomenduj** (zaufana, liczy się jako przegląd), **Oznacz jako przejrzaną**, ustaw **cykl przeglądu** lub **Wycofaj** z tabelą następczą.
3. **Odpowiadaj na pytania:** Mój pulpit listuje otwarte pytania do twoich tabel; odpowiedź powiadamia pytającego.
4. **Panuj nad zadaniami stewardship:** Mój pulpit › Zadania stewardship pokazuje należne przeglądy z akcjami jednym kliknięciem; przypomnienia przychodzą raz dziennie.
5. **Wczytuj metadane:** Import › Unity Catalog (lub system źródłowy) zamiast przepisywania — istniejące opisy zostają, nowe tabele i kolumny są dodawane.`],
    owner: ["Właściciel danych / BPO — odpowiedzialny za dane", `Właściciele są przypisywani jako osoby (BPO na hubie, właściciel na domenie, bazie, schemacie lub tabeli) i dopasowywani do konta po e-mailu. Własność dziedziczy się w dół i można ją nadpisać na każdym poziomie.

**Co możesz:** wszystko, co steward na twoich zasobach, a dodatkowo wskazać dla nich stewarda, potwierdzać własność i zatwierdzać użycie swoich danych w workflow produktu danych.

**Typowe zadania**
1. **Zatwierdź użycie danych (faza 1 · Data Sourcing):** projekt wskazujący twój obszar BPO pojawia się w Mój pulpit › Czeka na moją akcję. Otwórz, sprawdź cel, projekt i tabele, dołącz dokument potwierdzający i **Zatwierdź** — albo odrzuć z uzasadnieniem, co odsyła go do analityka.
2. **Potwierdź własność:** zakładka Governance › **Potwierdź własność** na zasobach, gdzie jesteś ustawiony jawnie (polityka: domyślnie co 180 dni); zaległe potwierdzenia pojawiają się w Zadaniach stewardship.
3. **Wskaż stewarda:** edytuj bazę, schemat lub tabelę i ustaw stewarda — wszystko poniżej go dziedziczy.
4. **Decyduj o wnioskach o dostęp** do swoich produktów danych razem z adminami (oboje są powiadamiani).`],
    pm: ["Kierownik projektu — projektowanie produktów danych", `**Co możesz:** czytać wszystko, wnioskować o dostęp, projektować nowe produkty danych, śledzić wszystkie projekty i produkty na stronie **Odkrywaj produkty danych** oraz dawać końcowy sign-off projektom, które złożyłeś. Bez edycji katalogu.

**Typowe zadania**
1. **Zaprojektuj produkt danych:** Marketplace › **Zaprojektuj nowy produkt danych**: nazwa, opis, typ hubu, projekt i use case (oba wymagane — stają się tagami Project i Use Case), opcjonalnie częstotliwość odświeżania, klasyfikacja, historyzacja, termin; zaznacz tabele SOURCE, które go zasilają; **Złóż**. Projekt trafia automatycznie do analityka biznesowego, a tabele źródłowe otrzymują tagi.
2. **Śledź postęp:** Odkrywaj produkty danych pokazuje fazę, dokładny status i czyjej akcji się oczekuje; rozwinięty wniosek pokazuje każdy krok jako kółko (zielone — zrobione, niebieskie — bieżące).
3. **Sign-off:** po „Released to PRD” projekt wraca do ciebie — **Sign-off** go kończy; gotowy produkt otrzymuje tagi Data Product, Project i Use Case.
4. **Wycofaj** projekt, który nie jest już potrzebny (tagi znikają z tabel źródłowych).`],
    ba: ["Analityk biznesowy / inżynier wymagań — sourcing i refinement", `**Co możesz:** czytać wszystko, działać w fazach 1 i 2 workflow produktu danych (podczas doprecyzowania możesz edytować wpisy projektu), wnioskować o dostęp. Bez edycji katalogu.

**Typowe zadania**
1. **Doprecyzuj projekt (faza 1):** złożony projekt pojawia się w Mój pulpit › Czeka na moją akcję. Otwórz, doprecyzuj wpisy, **Projekt doprecyzowany** (notatka wymagana, pliki opcjonalne).
2. **Udokumentuj sourcing:** wpisz system źródłowy, BPO, link LeanIX i stewarda; **Złóż i poproś o zatwierdzenie** wysyła go do BPO. Jeśli BPO odrzuci, wraca do ciebie z uzasadnieniem.
3. **Doprecyzuj produkt danych (faza 2):** po potwierdzeniu tabel przez Data Ingestion zakończ refinement notatkami (np. gdzie jest udokumentowany) i załącznikami — **Refinement zakończony** przekazuje go do Development; **Zwróć** odsyła.
4. **Dbaj o słownik:** każdy z odpowiedzialnością może tworzyć pojęcia biznesowe i łączyć je z tabelami i atrybutami.`],
    ingestion: ["Data Ingestion — wprowadzanie tabel", `**Co możesz:** czytać wszystko, działać w kroku ingestion fazy 1, wnioskować o dostęp. Bez edycji katalogu.

**Typowe zadania**
1. **Odbierz projekt:** po zatwierdzeniu użycia danych przez BPO pojawia się w Mój pulpit › Czeka na moją akcję.
2. **Wczytaj i potwierdź:** załaduj tabele do uzgodnionej warstwy, potem **Potwierdź ingestion** z lokalizacją wczytanych tabel (wymagane) — projekt przechodzi automatycznie do refinementu. **Zwróć** odsyła go z notatką do analityka.
3. **Zarejestruj tabele w katalogu** (ze stewardem lub adminem): Import › Unity Catalog wczytuje nowe schematy i tabele; zaplanowana synchronizacja utrzymuje je aktualne.`],
    dpd: ["Development & Test — budowa i wydanie", `**Co możesz:** czytać wszystko, działać w fazie 3 workflow produktu danych, wnioskować o dostęp. Bez edycji katalogu.

**Typowe zadania**
1. **Development:** doprecyzowany projekt pojawia się w Mój pulpit › Czeka na moją akcję. Potwierdź **Development** z notatkami o wyniku (pliki opcjonalne).
2. **UAT i SIT:** potwierdź kolejno **UAT** i **SIT**; na każdym kroku **Zwróć** odsyła projekt z uzasadnieniem.
3. **Wydanie:** zapisz **Released to PRD** — kierownik projektu, który złożył projekt, zostaje powiadomiony i daje końcowy sign-off.
4. **Udokumentuj lineage:** poproś stewarda lub admina o dodanie lineage od tabel źródłowych do nowych tabel gold, aby konsumenci widzieli, skąd pochodzą dane.`],
    admin: ["Admin — wszystko, łącznie ze strukturą i użytkownikami", `**Co możesz:** wszystko — tworzyć typy hubów, huby, domeny, bazy i schematy; ustawiać BPO, właścicieli i stewardów; zapraszać użytkowników i nadawać role; decydować o wnioskach o dostęp; usuwać wnioski workflow; przywracać historię; importować, eksportować, zrzucać i przywracać cały katalog; uruchamiać kopie i zadania; konfigurować SSO, mapowanie grup, agentów i klientów MCP.

**Typowe zadania**
1. **Zbuduj strukturę:** Pulpit › Nowy typ hubu, potem huby (z BPO i krajem), bazy (z domeną i warstwą medallion), schematy — albo wczytaj wszystko przez Import › Unity Catalog / Wczytaj źródło.
2. **Wdrażaj osoby:** Admin › Użytkownicy › Zaproś — e-mail, nazwa, role; przy SSO lub logowaniu nagłówkowym konta powstają przy pierwszym wejściu, a mapowanie grup → ról nadaje role.
3. **Decyduj o wnioskach o dostęp:** Marketplace lub Mój pulpit — zatwierdź lub odrzuć; wnioskujący jest powiadamiany.
4. **Eksploatuj:** Admin › Kopie zapasowe i zadania (harmonogram, test przywracania, profile sync), Dziennik audytu, Zrzut/Przywróć. Po każdym wdrożeniu sprawdź /healthz.
5. **Podłączaj agentów:** Admin › Użytkownicy › Zaproś agenta (klucz z zakresem odczytu lub zapisu) albo pozwól klientom MCP używać OAuth; zob. rozdział Agenci AI i MCP.`],
    agent: ["Agenci AI (MCP) — programowy odczyt i zmiana katalogu", `Agenci to konta techniczne bez roli governance. Rozmawiają z **POST /mcp** (JSON-RPC 2.0, Model Context Protocol) kluczem agenta wydanym przez admina, tokenem OAuth 2.1 uzyskanym jako człowiek lub — za uwierzytelniającym proxy — przekazaną tożsamością wywołującego.

**Typowe zadania**
1. **Czytanie:** get_overview, list_hubs/databases/schemas/tables, get_table (atrybuty, governance, ocena, otwarte pytania, użycie), search_catalog, get_lineage, list_glossary_terms; cały katalog dostępny jest też jako OKF Markdown przez resources/read (okf://…) i export_okf.
2. **Zapis (zakres zapisu, przy OAuth admin/steward):** create_* / update_* / delete_* dla hubów, baz, schematów, tabel, atrybutów, pojęć słownika; add_lineage; certify_table, review_table; add_comment. Każda zmiana jest audytowana pod nazwą agenta lub człowieka i używa tych samych reguł co interfejs.
3. **Trzymaj się limitów:** limity na poświadczenie odpowiadają 429 z Retry-After; serwer zwraca czytelne komunikaty przy naruszeniu reguł.`],
  },
  es: {
    guest: ["Invitado — leer y solicitar", `**Lo que ves:** todo el catálogo en solo lectura — tipos de hub, bases de datos, esquemas, tablas con atributos, glosario, linaje, páginas de gobernanza, el Marketplace y tu propio panel. Los botones de edición están ocultos.

**Tareas típicas**
1. **Encontrar datos:** escribe un término en el buscador (se buscan nombres, descripciones, términos de negocio, etiquetas, stewards) o despliega el árbol de la izquierda.
2. **Entender una tabla:** ábrela — las pestañas muestran atributos, gobernanza (propietario, steward, dominio, certificación), linaje y la discusión.
3. **Solicitar acceso a un producto de datos:** en un esquema gold pulsa **Solicitar acceso**, indica el propósito, envía. Deciden los admins; la respuesta llega en Mi panel.
4. **Hacer una pregunta:** en la pestaña Discusión publica una pregunta — steward y propietario reciben aviso y responden allí.
5. **Valorar una tabla** con las estrellas de la cabecera, para que otros vean en qué datos se confía.`],
    steward: ["Data Steward — mantener los metadatos", `**Lo que puedes hacer:** crear, editar y borrar tablas y atributos en los esquemas donde eres el steward efectivo (fijado en la tabla, esquema, base, dominio o hub); mantener descripciones, definiciones de negocio, sensibilidad, clasificación, términos de negocio y etiquetas; crear términos del glosario; añadir linaje entre tablas de tu responsabilidad; certificar y revisar tablas.

**Tareas típicas**
1. **Describir una tabla:** ábrela, **Editar**, rellena descripción, definición de negocio, propietario/steward específicos, etiquetas; guarda. Los atributos se editan directamente en la pestaña Atributos (tipo, nulabilidad, clave, sensibilidad, término de negocio).
2. **Certificar o revisar:** pestaña Gobernanza › **Avalar** (de confianza, cuenta como revisión), **Marcar como revisada**, fijar un **ciclo de revisión** o **Deprecar** con tabla sucesora.
3. **Responder preguntas:** Mi panel lista las preguntas abiertas sobre tus tablas; responder avisa a quien preguntó.
4. **Mantener las tareas de stewardship al día:** Mi panel › Tareas de stewardship muestra revisiones vencidas con acciones de un clic; los recordatorios llegan una vez al día.
5. **Cargar metadatos:** usa Importar › Unity Catalog (o un sistema fuente) en vez de teclear — las descripciones existentes se conservan, se añaden tablas y columnas nuevas.`],
    owner: ["Data Owner / BPO — responsable de los datos", `Los propietarios se asignan como personas (BPO en el hub, propietario en dominio, base, esquema o tabla) y se asocian a tu cuenta por e-mail. La propiedad se hereda hacia abajo y puede sobrescribirse en cada nivel.

**Lo que puedes hacer:** todo lo que un steward puede en tus activos, además de nombrar su data steward, confirmar la propiedad y aprobar el uso de tus datos en el flujo de productos de datos.

**Tareas típicas**
1. **Aprobar el uso de datos (fase 1 · Data Sourcing):** un diseño que nombra tu área BPO llega a Mi panel › Pendiente de mi acción. Ábrelo, revisa propósito, proyecto y tablas, adjunta el documento de confirmación y **Aprobar** — o rechaza con motivo, lo que lo devuelve al analista.
2. **Confirmar la propiedad:** pestaña Gobernanza › **Confirmar propiedad** en los activos donde estás fijado explícitamente (política por defecto: cada 180 días); las atestaciones vencidas aparecen en Tareas de stewardship.
3. **Asignar un steward:** edita la base, esquema o tabla y fija el steward — todo lo de abajo lo hereda.
4. **Decidir solicitudes de acceso** a tus productos de datos junto con los admins (ambos reciben aviso).`],
    pm: ["Jefe de proyecto — diseñar productos de datos", `**Lo que puedes hacer:** leer todo, solicitar acceso, diseñar nuevos productos de datos, seguir todos los diseños y productos en la página **Descubrir productos de datos** y dar el sign-off final a los diseños que enviaste. Sin ediciones del catálogo.

**Tareas típicas**
1. **Diseñar un producto de datos:** Marketplace › **Diseñar un nuevo producto de datos**: nombre, descripción, tipo de hub, proyecto y caso de uso (ambos obligatorios — se convierten en las etiquetas Project y Use Case), opcionalmente frecuencia de actualización, clasificación, historización, fecha necesaria; marca las tablas SOURCE que lo alimentan; **Enviar**. El diseño pasa automáticamente al analista de negocio y las tablas fuente reciben las etiquetas.
2. **Seguir el progreso:** Descubrir productos de datos muestra fase, estado exacto y de quién se espera acción; la solicitud desplegada muestra cada paso como un círculo (verde hecho, azul actual).
3. **Sign-off:** tras Released to PRD el diseño vuelve a ti — **Sign-off** lo completa; el producto terminado recibe las etiquetas Data Product, Project y Use Case.
4. **Retirar** un diseño que ya no se necesita (sus etiquetas se quitan de las tablas fuente).`],
    ba: ["Analista de negocio / ingeniero de requisitos — sourcing y refinamiento", `**Lo que puedes hacer:** leer todo, actuar en las fases 1 y 2 del flujo de productos de datos (al refinar puedes editar las entradas del diseño), solicitar acceso. Sin ediciones del catálogo.

**Tareas típicas**
1. **Refinar el diseño (fase 1):** un diseño enviado aparece en Mi panel › Pendiente de mi acción. Ábrelo, afina las entradas, **Diseño refinado** (nota obligatoria, archivos opcionales).
2. **Documentar el sourcing:** indica sistema fuente, BPO, enlace LeanIX y data steward; **Enviar y solicitar aprobación** lo manda al BPO. Si el BPO rechaza, vuelve a ti con el motivo.
3. **Refinar el producto de datos (fase 2):** cuando Data Ingestion confirmó las tablas, completa el refinamiento con notas (p. ej. dónde está documentado) y adjuntos — **Refinamiento completado** lo pasa a Desarrollo; **Devolver** lo regresa.
4. **Mantener el glosario al día:** cualquiera con una responsabilidad puede crear términos de negocio y vincularlos a tablas y atributos.`],
    ingestion: ["Data Ingestion — traer las tablas", `**Lo que puedes hacer:** leer todo, actuar en el paso de ingesta de la fase 1, solicitar acceso. Sin ediciones del catálogo.

**Tareas típicas**
1. **Recoger el diseño:** tras aprobar el BPO el uso de datos aparece en Mi panel › Pendiente de mi acción.
2. **Ingestar y confirmar:** carga las tablas en la capa acordada y **Confirmar ingesta** con la ubicación de las tablas ingestadas (obligatorio) — el diseño pasa automáticamente al refinamiento. **Devolver** lo regresa al analista con una nota.
3. **Registrar las tablas en el catálogo** (con un steward o admin): Importar › Unity Catalog carga los nuevos esquemas y tablas; una sincronización programada los mantiene al día.`],
    dpd: ["Desarrollo y pruebas — construir y liberar", `**Lo que puedes hacer:** leer todo, actuar en la fase 3 del flujo de productos de datos, solicitar acceso. Sin ediciones del catálogo.

**Tareas típicas**
1. **Desarrollo:** el diseño refinado aparece en Mi panel › Pendiente de mi acción. Confirma **Desarrollo** con notas del resultado (archivos opcionales).
2. **UAT y SIT:** confirma **UAT** y **SIT** uno tras otro; en cualquier paso **Devolver** regresa el diseño con un motivo.
3. **Liberar:** registra **Released to PRD** — el jefe de proyecto que envió el diseño recibe aviso y da el sign-off final.
4. **Documentar el linaje:** pide al steward o admin que añada linaje de las tablas fuente a las nuevas tablas gold, para que los consumidores vean de dónde vienen los datos.`],
    admin: ["Admin — todo, incluida la estructura y los usuarios", `**Lo que puedes hacer:** todo — crear tipos de hub, hubs, dominios, bases y esquemas; fijar BPO, propietarios y stewards; invitar usuarios y asignar roles; decidir solicitudes de acceso; borrar solicitudes del flujo; restaurar el historial; importar, exportar, volcar y restaurar todo el catálogo; ejecutar copias y trabajos; configurar SSO, asignación de grupos, agentes y clientes MCP.

**Tareas típicas**
1. **Montar la estructura:** Panel › Nuevo tipo de hub, luego hubs (con BPO y país), bases (con dominio y capa medallion), esquemas — o cargarlo todo con Importar › Unity Catalog / Cargar fuente.
2. **Incorporar personas:** Admin › Usuarios › Invitar — e-mail, nombre, roles; con SSO o inicio de sesión por cabecera las cuentas aparecen al primer acceso y la asignación grupo → rol asigna los roles.
3. **Decidir solicitudes de acceso:** Marketplace o Mi panel — aprobar o rechazar; el solicitante recibe aviso.
4. **Operar:** Admin › Copias de seguridad y trabajos (programación, simulacro de restauración, perfiles de sync), Auditoría, Volcado/Restaurar. Comprueba /healthz tras cada despliegue.
5. **Conectar agentes:** Admin › Usuarios › Invitar agente (clave con alcance de lectura o escritura) o dejar que los clientes MCP usen OAuth; ver el capítulo Agentes de IA y MCP.`],
    agent: ["Agentes de IA (MCP) — leer y cambiar el catálogo por programa", `Los agentes son cuentas técnicas sin rol de gobernanza. Hablan con **POST /mcp** (JSON-RPC 2.0, Model Context Protocol) con una clave de agente emitida por un admin, un token OAuth 2.1 obtenido como usuario humano o — tras un proxy que autentica — la identidad reenviada de quien llama.

**Tareas típicas**
1. **Leer:** get_overview, list_hubs/databases/schemas/tables, get_table (atributos, gobernanza, valoración, preguntas abiertas, uso), search_catalog, get_lineage, list_glossary_terms; todo el catálogo también está disponible como OKF Markdown vía resources/read (okf://…) y export_okf.
2. **Escribir (alcance de escritura, admin/steward con OAuth):** create_* / update_* / delete_* de hubs, bases, esquemas, tablas, atributos, términos del glosario; add_lineage; certify_table, review_table; add_comment. Cada cambio se audita con el nombre del agente o del humano y usa las mismas comprobaciones que la interfaz.
3. **Respetar los límites:** los límites por credencial responden 429 con Retry-After; el servidor devuelve textos de error legibles ante violaciones de reglas.`],
  },
  fr: {
    guest: ["Invité — lire et demander", `**Ce que vous voyez :** tout le catalogue en lecture seule — types de hubs, bases, schémas, tables avec attributs, glossaire, lignage, pages de gouvernance, la Marketplace et votre tableau de bord. Les boutons d'édition sont masqués.

**Tâches typiques**
1. **Trouver des données :** saisissez un terme dans la recherche (noms, descriptions, termes métier, tags, stewards sont parcourus) ou dépliez l'arbre à gauche.
2. **Comprendre une table :** ouvrez-la — les onglets montrent attributs, gouvernance (propriétaire, steward, domaine, certification), lignage et discussion.
3. **Demander l'accès à un produit de données :** sur un schéma gold cliquez **Demander l'accès**, indiquez l'objectif, envoyez. Les admins décident ; la réponse arrive dans Mon tableau de bord.
4. **Poser une question :** dans l'onglet Discussion publiez une question — steward et propriétaire sont notifiés et répondent là.
5. **Noter une table** avec les étoiles de l'en-tête, pour que les autres voient quelles données sont fiables.`],
    steward: ["Data Steward — maintenir les métadonnées", `**Ce que vous pouvez faire :** créer, modifier et supprimer tables et attributs dans les schémas dont vous êtes le steward effectif (défini sur la table, le schéma, la base, le domaine ou le hub) ; maintenir descriptions, définitions métier, sensibilité, classification, termes métier et tags ; créer des termes de glossaire ; ajouter du lignage entre les tables sous votre responsabilité ; certifier et revoir les tables.

**Tâches typiques**
1. **Décrire une table :** ouvrez-la, **Modifier**, remplissez description, définition métier, propriétaire/steward spécifiques, tags ; enregistrez. Les attributs se modifient directement dans l'onglet Attributs (type, nullabilité, clé, sensibilité, terme métier).
2. **Certifier ou revoir :** onglet Gouvernance › **Approuver** (fiable, compte comme revue), **Marquer comme revue**, définir un **cycle de revue** ou **Déprécier** avec une table successeur.
3. **Répondre aux questions :** Mon tableau de bord liste les questions ouvertes sur vos tables ; répondre notifie le demandeur.
4. **Garder les tâches de stewardship à jour :** Mon tableau de bord › Tâches de stewardship montre les revues dues avec des actions en un clic ; les rappels arrivent une fois par jour.
5. **Charger des métadonnées :** utilisez Import › Unity Catalog (ou un système source) plutôt que de saisir — les descriptions existantes sont conservées, les nouvelles tables et colonnes ajoutées.`],
    owner: ["Data Owner / BPO — responsable des données", `Les propriétaires sont affectés comme personnes (BPO sur le hub, propriétaire sur domaine, base, schéma ou table) et rattachés à votre compte par e-mail. La propriété s'hérite vers le bas et peut être remplacée à chaque niveau.

**Ce que vous pouvez faire :** tout ce qu'un steward peut sur vos actifs, plus nommer leur data steward, confirmer la propriété et approuver l'usage de vos données dans le workflow des produits de données.

**Tâches typiques**
1. **Approuver l'usage des données (phase 1 · Data Sourcing) :** une conception nommant votre périmètre BPO arrive dans Mon tableau de bord › En attente de mon action. Ouvrez-la, vérifiez objectif, projet et tables, joignez le document de confirmation et **Approuver** — ou refusez avec un motif, ce qui la renvoie à l'analyste.
2. **Confirmer la propriété :** onglet Gouvernance › **Confirmer la propriété** sur les actifs où vous êtes défini explicitement (politique par défaut : tous les 180 jours) ; les attestations en retard apparaissent dans les Tâches de stewardship.
3. **Affecter un steward :** modifiez la base, le schéma ou la table et définissez le steward — tout ce qui est en dessous en hérite.
4. **Décider des demandes d'accès** à vos produits de données avec les admins (les deux sont notifiés).`],
    pm: ["Chef de projet — concevoir des produits de données", `**Ce que vous pouvez faire :** tout lire, demander l'accès, concevoir de nouveaux produits de données, suivre toutes les conceptions et tous les produits sur la page **Découvrir les produits de données** et donner le sign-off final aux conceptions que vous avez soumises. Pas d'édition du catalogue.

**Tâches typiques**
1. **Concevoir un produit de données :** Marketplace › **Concevoir un nouveau produit de données** : nom, description, type de hub, projet et cas d'usage (obligatoires — ils deviennent les tags Project et Use Case), éventuellement fréquence de rafraîchissement, classification, historisation, date de besoin ; cochez les tables SOURCE qui l'alimentent ; **Soumettre**. La conception part automatiquement vers l'analyste métier et les tables sources reçoivent les tags.
2. **Suivre l'avancement :** Découvrir les produits de données montre la phase, le statut exact et de qui l'action est attendue ; la demande dépliée montre chaque étape comme un cercle (vert fait, bleu en cours).
3. **Sign-off :** après Released to PRD la conception vous revient — **Sign-off** la termine ; le produit fini reçoit les tags Data Product, Project et Use Case.
4. **Retirer** une conception devenue inutile (ses tags sont retirés des tables sources).`],
    ba: ["Analyste métier / ingénieur des exigences — sourcing et affinage", `**Ce que vous pouvez faire :** tout lire, agir dans les phases 1 et 2 du workflow des produits de données (vous pouvez modifier les entrées de la conception pendant l'affinage), demander l'accès. Pas d'édition du catalogue.

**Tâches typiques**
1. **Affiner la conception (phase 1) :** une conception soumise apparaît dans Mon tableau de bord › En attente de mon action. Ouvrez-la, précisez les entrées, **Conception affinée** (note obligatoire, fichiers facultatifs).
2. **Documenter le sourcing :** saisissez système source, BPO, lien LeanIX et data steward ; **Soumettre et demander l'approbation** l'envoie au BPO. Si le BPO refuse, elle vous revient avec le motif.
3. **Affiner le produit de données (phase 2) :** une fois les tables confirmées par Data Ingestion, terminez l'affinage avec des notes (p. ex. où il est documenté) et des pièces jointes — **Affinage terminé** le transmet au Développement ; **Renvoyer** le fait revenir.
4. **Tenir le glossaire à jour :** toute personne ayant une responsabilité peut créer des termes métier et les lier aux tables et attributs.`],
    ingestion: ["Data Ingestion — faire entrer les tables", `**Ce que vous pouvez faire :** tout lire, agir à l'étape d'ingestion de la phase 1, demander l'accès. Pas d'édition du catalogue.

**Tâches typiques**
1. **Prendre la conception :** après l'approbation de l'usage des données par le BPO elle apparaît dans Mon tableau de bord › En attente de mon action.
2. **Ingérer et confirmer :** chargez les tables dans la couche convenue puis **Confirmer l'ingestion** avec l'emplacement des tables ingérées (obligatoire) — la conception passe automatiquement à l'affinage. **Renvoyer** la retourne à l'analyste avec une note.
3. **Enregistrer les tables dans le catalogue** (avec un steward ou un admin) : Import › Unity Catalog charge les nouveaux schémas et tables ; une synchronisation planifiée les tient à jour.`],
    dpd: ["Développement et test — construire et livrer", `**Ce que vous pouvez faire :** tout lire, agir dans la phase 3 du workflow des produits de données, demander l'accès. Pas d'édition du catalogue.

**Tâches typiques**
1. **Développement :** la conception affinée apparaît dans Mon tableau de bord › En attente de mon action. Confirmez **Développement** avec des notes sur le résultat (fichiers facultatifs).
2. **UAT et SIT :** confirmez **UAT** puis **SIT** ; à chaque étape **Renvoyer** retourne la conception avec un motif.
3. **Livrer :** enregistrez **Released to PRD** — le chef de projet qui a soumis la conception est notifié et donne le sign-off final.
4. **Documenter le lignage :** demandez au steward ou à l'admin d'ajouter le lignage des tables sources vers les nouvelles tables gold, pour que les consommateurs voient d'où viennent les données.`],
    admin: ["Admin — tout, y compris la structure et les utilisateurs", `**Ce que vous pouvez faire :** tout — créer types de hubs, hubs, domaines, bases et schémas ; définir BPO, propriétaires et stewards ; inviter des utilisateurs et attribuer des rôles ; décider des demandes d'accès ; supprimer des demandes de workflow ; restaurer l'historique ; importer, exporter, dumper et restaurer tout le catalogue ; lancer sauvegardes et tâches ; configurer SSO, mapping des groupes, agents et clients MCP.

**Tâches typiques**
1. **Mettre en place la structure :** Tableau de bord › Nouveau type de hub, puis hubs (avec BPO et pays), bases (avec domaine et couche medallion), schémas — ou tout charger via Import › Unity Catalog / Charger une source.
2. **Intégrer des personnes :** Admin › Utilisateurs › Inviter — e-mail, nom, rôles ; avec SSO ou connexion par en-tête les comptes apparaissent à la première connexion et le mapping groupe → rôle attribue les rôles.
3. **Décider des demandes d'accès :** Marketplace ou Mon tableau de bord — approuver ou refuser ; le demandeur est notifié.
4. **Exploiter :** Admin › Sauvegardes et tâches (planification, test de restauration, profils de sync), Journal d'audit, Dump/Restaurer. Vérifiez /healthz après chaque déploiement.
5. **Connecter des agents :** Admin › Utilisateurs › Inviter un agent (clé en lecture ou écriture) ou laisser les clients MCP utiliser OAuth ; voir le chapitre Agents IA et MCP.`],
    agent: ["Agents IA (MCP) — lire et modifier le catalogue par programme", `Les agents sont des comptes techniques sans rôle de gouvernance. Ils parlent à **POST /mcp** (JSON-RPC 2.0, Model Context Protocol) avec une clé d'agent délivrée par un admin, un jeton OAuth 2.1 obtenu en tant qu'humain ou — derrière un proxy authentifiant — l'identité transmise de l'appelant.

**Tâches typiques**
1. **Lire :** get_overview, list_hubs/databases/schemas/tables, get_table (attributs, gouvernance, note, questions ouvertes, usage), search_catalog, get_lineage, list_glossary_terms ; tout le catalogue est aussi disponible en OKF Markdown via resources/read (okf://…) et export_okf.
2. **Écrire (portée écriture, admin/steward avec OAuth) :** create_* / update_* / delete_* pour hubs, bases, schémas, tables, attributs, termes de glossaire ; add_lineage ; certify_table, review_table ; add_comment. Chaque modification est auditée au nom de l'agent ou de l'humain et passe par les mêmes contrôles que l'interface.
3. **Respecter les limites :** les limites par identifiant répondent 429 avec Retry-After ; le serveur renvoie des messages d'erreur lisibles en cas de violation des règles.`],
  },
  it: {
    guest: ["Ospite — leggere e richiedere", `**Cosa vedi:** l'intero catalogo in sola lettura — tipi di hub, database, schemi, tabelle con attributi, glossario, lineage, pagine di governance, il Marketplace e la tua dashboard. I pulsanti di modifica sono nascosti.

**Attività tipiche**
1. **Trovare dati:** digita un termine nella ricerca (si cercano nomi, descrizioni, termini di business, tag, steward) oppure espandi l'albero a sinistra.
2. **Capire una tabella:** aprila — le schede mostrano attributi, governance (owner, steward, dominio, certificazione), lineage e discussione.
3. **Richiedere l'accesso a un prodotto dati:** su uno schema gold clicca **Richiedi accesso**, indica lo scopo, invia. Decidono gli admin; la risposta arriva in La mia dashboard.
4. **Fare una domanda:** nella scheda Discussione pubblica una domanda — steward e owner vengono avvisati e rispondono lì.
5. **Valutare una tabella** con le stelle nell'intestazione, così gli altri vedono di quali dati ci si fida.`],
    steward: ["Data Steward — mantenere i metadati", `**Cosa puoi fare:** creare, modificare ed eliminare tabelle e attributi negli schemi in cui sei lo steward effettivo (impostato su tabella, schema, database, dominio o hub); mantenere descrizioni, definizioni di business, sensibilità, classificazione, termini di business e tag; creare termini del glossario; aggiungere lineage tra tabelle di tua responsabilità; certificare e revisionare tabelle.

**Attività tipiche**
1. **Descrivere una tabella:** aprila, **Modifica**, compila descrizione, definizione di business, owner/steward specifici, tag; salva. Gli attributi si modificano direttamente nella scheda Attributi (tipo, nullabilità, chiave, sensibilità, termine di business).
2. **Certificare o revisionare:** scheda Governance › **Approva** (affidabile, vale come revisione), **Segna come revisionata**, imposta un **ciclo di revisione** oppure **Depreca** con tabella successiva.
3. **Rispondere alle domande:** La mia dashboard elenca le domande aperte sulle tue tabelle; rispondere avvisa chi ha chiesto.
4. **Tenere in ordine le attività di stewardship:** La mia dashboard › Attività di stewardship mostra le revisioni in scadenza con azioni a un clic; i promemoria arrivano una volta al giorno.
5. **Caricare metadati:** usa Import › Unity Catalog (o un sistema sorgente) invece di digitare — le descrizioni esistenti restano, tabelle e colonne nuove vengono aggiunte.`],
    owner: ["Data Owner / BPO — responsabile dei dati", `Gli owner sono assegnati come persone (BPO sull'hub, owner su dominio, database, schema o tabella) e associati al tuo account tramite e-mail. La proprietà si eredita verso il basso e può essere sovrascritta a ogni livello.

**Cosa puoi fare:** tutto ciò che può uno steward sui tuoi asset, in più nominare il loro data steward, confermare la proprietà e approvare l'uso dei tuoi dati nel workflow dei prodotti dati.

**Attività tipiche**
1. **Approvare l'uso dei dati (fase 1 · Data Sourcing):** un progetto che indica la tua area BPO arriva in La mia dashboard › In attesa di una mia azione. Aprilo, controlla scopo, progetto e tabelle, allega il documento di conferma e **Approva** — oppure rifiuta con motivazione, che lo rimanda all'analista.
2. **Confermare la proprietà:** scheda Governance › **Conferma proprietà** sugli asset in cui sei impostato esplicitamente (policy predefinita: ogni 180 giorni); le attestazioni scadute compaiono in Attività di stewardship.
3. **Assegnare uno steward:** modifica database, schema o tabella e imposta lo steward — tutto ciò che sta sotto lo eredita.
4. **Decidere le richieste di accesso** ai tuoi prodotti dati insieme agli admin (entrambi vengono avvisati).`],
    pm: ["Project Manager — progettare prodotti dati", `**Cosa puoi fare:** leggere tutto, richiedere l'accesso, progettare nuovi prodotti dati, seguire tutti i progetti e prodotti nella pagina **Scopri i prodotti dati** e dare il sign-off finale ai progetti che hai inviato. Nessuna modifica al catalogo.

**Attività tipiche**
1. **Progettare un prodotto dati:** Marketplace › **Progetta un nuovo prodotto dati**: nome, descrizione, tipo di hub, progetto e caso d'uso (entrambi obbligatori — diventano i tag Project e Use Case), facoltativamente frequenza di aggiornamento, classificazione, storicizzazione, data di necessità; spunta le tabelle SOURCE che lo alimentano; **Invia**. Il progetto va automaticamente al business analyst e le tabelle sorgente ricevono i tag.
2. **Seguire l'avanzamento:** Scopri i prodotti dati mostra fase, stato esatto e di chi si attende l'azione; la richiesta espansa mostra ogni passo come un cerchio (verde fatto, blu corrente).
3. **Sign-off:** dopo Released to PRD il progetto torna a te — **Sign-off** lo completa; il prodotto finito riceve i tag Data Product, Project e Use Case.
4. **Ritirare** un progetto non più necessario (i suoi tag vengono rimossi dalle tabelle sorgente).`],
    ba: ["Business Analyst / Requirements Engineer — sourcing e refinement", `**Cosa puoi fare:** leggere tutto, agire nelle fasi 1 e 2 del workflow dei prodotti dati (durante il refinement puoi modificare le voci del progetto), richiedere l'accesso. Nessuna modifica al catalogo.

**Attività tipiche**
1. **Affinare il progetto (fase 1):** un progetto inviato compare in La mia dashboard › In attesa di una mia azione. Aprilo, precisa le voci, **Progetto affinato** (nota obbligatoria, file facoltativi).
2. **Documentare il sourcing:** inserisci sistema sorgente, BPO, link LeanIX e data steward; **Invia e richiedi approvazione** lo manda al BPO. Se il BPO rifiuta, torna a te con la motivazione.
3. **Affinare il prodotto dati (fase 2):** dopo che Data Ingestion ha confermato le tabelle, completa il refinement con note (es. dove è documentato) e allegati — **Refinement completato** lo passa allo Sviluppo; **Restituisci** lo rimanda indietro.
4. **Tenere aggiornato il glossario:** chiunque abbia una responsabilità può creare termini di business e collegarli a tabelle e attributi.`],
    ingestion: ["Data Ingestion — portare dentro le tabelle", `**Cosa puoi fare:** leggere tutto, agire nel passo di ingestion della fase 1, richiedere l'accesso. Nessuna modifica al catalogo.

**Attività tipiche**
1. **Prendere in carico il progetto:** dopo l'approvazione dell'uso dei dati da parte del BPO compare in La mia dashboard › In attesa di una mia azione.
2. **Caricare e confermare:** carica le tabelle nel layer concordato, poi **Conferma ingestion** con la posizione delle tabelle caricate (obbligatoria) — il progetto passa automaticamente al refinement. **Restituisci** lo rimanda all'analista con una nota.
3. **Registrare le tabelle nel catalogo** (con uno steward o un admin): Import › Unity Catalog carica i nuovi schemi e tabelle; una sincronizzazione pianificata li tiene aggiornati.`],
    dpd: ["Sviluppo e test — costruire e rilasciare", `**Cosa puoi fare:** leggere tutto, agire nella fase 3 del workflow dei prodotti dati, richiedere l'accesso. Nessuna modifica al catalogo.

**Attività tipiche**
1. **Sviluppo:** il progetto affinato compare in La mia dashboard › In attesa di una mia azione. Conferma **Sviluppo** con note sul risultato (file facoltativi).
2. **UAT e SIT:** conferma **UAT** e **SIT** uno dopo l'altro; in ogni passo **Restituisci** rimanda il progetto con una motivazione.
3. **Rilascio:** registra **Released to PRD** — il project manager che ha inviato il progetto viene avvisato e dà il sign-off finale.
4. **Documentare il lineage:** chiedi allo steward o all'admin di aggiungere il lineage dalle tabelle sorgente alle nuove tabelle gold, così i consumatori vedono da dove vengono i dati.`],
    admin: ["Admin — tutto, compresi struttura e utenti", `**Cosa puoi fare:** tutto — creare tipi di hub, hub, domini, database e schemi; impostare BPO, owner e steward; invitare utenti e assegnare ruoli; decidere le richieste di accesso; eliminare richieste di workflow; ripristinare la cronologia; importare, esportare, scaricare e ripristinare l'intero catalogo; eseguire backup e job; configurare SSO, mappatura gruppi, agenti e client MCP.

**Attività tipiche**
1. **Costruire la struttura:** Dashboard › Nuovo tipo di hub, poi hub (con BPO e paese), database (con dominio e layer medallion), schemi — oppure caricare tutto con Import › Unity Catalog / Carica sorgente.
2. **Inserire persone:** Admin › Utenti › Invita — e-mail, nome, ruoli; con SSO o accesso tramite header gli account compaiono al primo accesso e la mappatura gruppo → ruolo assegna i ruoli.
3. **Decidere le richieste di accesso:** Marketplace o La mia dashboard — approva o rifiuta; il richiedente viene avvisato.
4. **Esercizio:** Admin › Backup e job (pianificazione, prova di ripristino, profili di sync), Audit trail, Dump/Ripristina. Controlla /healthz dopo ogni deployment.
5. **Collegare agenti:** Admin › Utenti › Invita agente (chiave con ambito lettura o scrittura) oppure lascia che i client MCP usino OAuth; vedi il capitolo Agenti AI e MCP.`],
    agent: ["Agenti AI (MCP) — leggere e modificare il catalogo via programma", `Gli agenti sono account tecnici senza ruolo di governance. Parlano con **POST /mcp** (JSON-RPC 2.0, Model Context Protocol) con una chiave agente rilasciata da un admin, un token OAuth 2.1 ottenuto come utente umano oppure — dietro un proxy che autentica — l'identità inoltrata del chiamante.

**Attività tipiche**
1. **Leggere:** get_overview, list_hubs/databases/schemas/tables, get_table (attributi, governance, valutazione, domande aperte, utilizzo), search_catalog, get_lineage, list_glossary_terms; l'intero catalogo è disponibile anche come OKF Markdown via resources/read (okf://…) ed export_okf.
2. **Scrivere (ambito scrittura, admin/steward con OAuth):** create_* / update_* / delete_* per hub, database, schemi, tabelle, attributi, termini del glossario; add_lineage; certify_table, review_table; add_comment. Ogni modifica è registrata nell'audit a nome dell'agente o dell'umano e usa gli stessi controlli dell'interfaccia.
3. **Rispettare i limiti:** i limiti per credenziale rispondono 429 con Retry-After; il server restituisce messaggi di errore leggibili in caso di violazione delle regole.`],
  },
};

/* modal subtitle (replaces the pre-v1.62 role line of help-content.js) */
const SUB = {
  en: "How the Alassio Data Catalog works — by chapter: start with a guide for your role, then look up any feature. Use the search box to find a topic across all chapters. Figures, worked examples and tips illustrate each feature; “Open as handbook” renders everything as one printable document.",
  de: "So funktioniert der Alassio Data Catalog — nach Kapiteln: starte mit der Anleitung für deine Rolle, dann schlag jede Funktion nach. Das Suchfeld findet ein Thema über alle Kapitel hinweg. Abbildungen, Beispiele und Tipps veranschaulichen jede Funktion; „Als Handbuch öffnen“ zeigt alles als druckbares Dokument.",
  pl: "Jak działa Alassio Data Catalog — rozdziałami: zacznij od przewodnika dla swojej roli, potem sprawdź dowolną funkcję. Pole wyszukiwania znajduje temat we wszystkich rozdziałach. Ilustracje, przykłady i wskazówki objaśniają każdą funkcję; „Otwórz jako podręcznik” pokazuje wszystko jako dokument do druku.",
  es: "Cómo funciona el Alassio Data Catalog — por capítulos: empieza con la guía de tu rol y luego consulta cualquier función. El buscador encuentra un tema en todos los capítulos. Figuras, ejemplos y consejos ilustran cada función; «Abrir como manual» muestra todo como un documento imprimible.",
  fr: "Comment fonctionne le Alassio Data Catalog — par chapitres : commencez par le guide de votre rôle, puis consultez chaque fonction. La recherche trouve un sujet dans tous les chapitres. Figures, exemples et conseils illustrent chaque fonction ; « Ouvrir comme manuel » affiche le tout en document imprimable.",
  it: "Come funziona il Alassio Data Catalog — per capitoli: inizia dalla guida per il tuo ruolo, poi consulta ogni funzione. La ricerca trova un argomento in tutti i capitoli. Figure, esempi e suggerimenti illustrano ogni funzione; «Apri come manuale» mostra tutto come documento stampabile.",
};
const UI = {
  en: { search: "Search the help…", noHits: "No help section matches.", role: "Your role", yourRoles: "your roles", allRoles: "All roles", results: "Search results" },
  de: { search: "Hilfe durchsuchen…", noHits: "Kein Hilfeabschnitt passt.", role: "Deine Rolle", yourRoles: "deine Rollen", allRoles: "Alle Rollen", results: "Suchergebnisse" },
  pl: { search: "Przeszukaj pomoc…", noHits: "Żadna sekcja pomocy nie pasuje.", role: "Twoja rola", yourRoles: "twoje role", allRoles: "Wszystkie role", results: "Wyniki wyszukiwania" },
  es: { search: "Buscar en la ayuda…", noHits: "Ninguna sección de ayuda coincide.", role: "Tu rol", yourRoles: "tus roles", allRoles: "Todos los roles", results: "Resultados de búsqueda" },
  fr: { search: "Rechercher dans l'aide…", noHits: "Aucune section d'aide ne correspond.", role: "Votre rôle", yourRoles: "vos rôles", allRoles: "Tous les rôles", results: "Résultats de recherche" },
  it: { search: "Cerca nella guida…", noHits: "Nessuna sezione della guida corrisponde.", role: "Il tuo ruolo", yourRoles: "i tuoi ruoli", allRoles: "Tutti i ruoli", results: "Risultati della ricerca" },
};

/* the account roles that map to a guide (owner is people-based: offered to everyone) */
export const ROLE_OF_ACCOUNT = { admin: "admin", steward: "steward", pm: "pm", ba: "ba", ingestion: "ingestion", dpd: "dpd", guest: "guest", agent: "agent" };

export function helpChapters(lang) {
  const l = CH[lang] ? lang : "en";
  const h = HELP[l] || HELP.en;
  const manual = manualFor(l);   /* v1.65: figures, worked examples and tips per section */
  return {
    title: h.title, sub: SUB[l], ui: UI[l], manual: manual.ui, figLabels: manual.figLabels,
    chapters: CHAPTERS.map((c) => ({
      id: c.id, icon: c.icon, adminOnly: !!c.adminOnly, title: CH[l][c.id][0], intro: CH[l][c.id][1],
      sections: c.id === "roles"
        ? ROLE_IDS.map((r) => ({ id: r, role: r, icon: r === "agent" ? "bot" : r === "admin" ? "usercog" : "users", title: ROLES[l][r][0], body: ROLES[l][r][1] }))
        : c.sections.map((i) => ({ id: `${c.id}-${i}`, icon: h.sections[i].icon, title: h.sections[i].title, body: h.sections[i].body, adminOnly: !!h.sections[i].adminOnly, ...(manual.sections[i] || {}) })),
    })),
  };
}
