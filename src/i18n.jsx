import { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { DICT_FULL } from "./i18n-dict.js";
import { DICT_EXT } from "./i18n-dict-ext.js";
import { DICT_FR } from "./i18n-fr.js";
import { DICT_IT } from "./i18n-it.js";
import { apiPatch } from "./lib/api.js";
import { fill, pluralKey } from "./lib/i18n-format.js";   /* no cycle: api.js → download.js → csrf.js never import i18n */

/* UI languages. Keys are English source strings; a missing translation falls back to English.
   Add a language: extend LANGS and the dictionary — nothing else changes. */
export const LANGS = [["en", "English", "🇬🇧"], ["de", "Deutsch", "🇩🇪"], ["pl", "Polski", "🇵🇱"], ["es", "Español", "🇪🇸"], ["fr", "Français", "🇫🇷"], ["it", "Italiano", "🇮🇹"]];
/* BCP-47 tags for <html lang> and date formatting */
export const LOCALE = { en: "en-GB", de: "de-DE", pl: "pl-PL", es: "es-ES", fr: "fr-FR", it: "it-IT" };

const DICT = {
  de: {
    "My Dashboard": "Mein Dashboard", "Import": "Import", "Export": "Export", "Glossary": "Glossar", "Marketplace": "Marktplatz",
    "Discover Data Products": "Datenprodukte entdecken", "Inbox": "Posteingang", "Admin": "Admin", "Governance Overview": "Governance-Übersicht",
    "Users": "Benutzer", "Audit trail": "Audit-Trail", "Dump": "Dump", "Restore": "Wiederherstellen", "Export Glossary Terms": "Glossarbegriffe exportieren",
    "Unity Catalog": "Unity Catalog", "Load source": "Quelle laden", "Import CSV": "CSV importieren", "Export CSV": "CSV exportieren", "Export OKF": "OKF exportieren", "Write back to UC": "Nach UC zurückschreiben",
    "Search hubs, databases, schemas, tables, attributes…": "Hubs, Datenbanken, Schemata, Tabellen, Attribute suchen…",
    "Help and feature guide": "Hilfe und Funktionsübersicht", "Sign out": "Abmelden", "Security": "Sicherheit", "Language": "Sprache",
    "Sign in": "Anmelden", "Use your Alassio Data Catalog account.": "Melde dich mit deinem Alassio-Data-Catalog-Konto an.",
    "E-mail": "E-Mail", "Password": "Passwort", "Password (min. 8 characters)": "Passwort (mind. 8 Zeichen)", "Authenticator code": "Authenticator-Code", "Name": "Name",
    "Create the first administrator": "Ersten Administrator anlegen", "No accounts exist yet — this account will have the admin role.": "Es gibt noch keine Konten — dieses Konto erhält die Admin-Rolle.",
    "Create admin account": "Admin-Konto anlegen", "Activate account": "Konto aktivieren", "Sign in with Microsoft": "Mit Microsoft anmelden", "or": "oder",
    "Data hubs": "Data Hubs", "Data products": "Datenprodukte", "Data owners": "Data Owner", "Data stewards": "Data Stewards", "Full lineage": "Gesamte Lineage", "New data hub": "Neuer Data Hub",
    "Save": "Speichern", "Cancel": "Abbrechen", "Create": "Anlegen", "Edit": "Bearbeiten", "Delete": "Löschen", "Close": "Schließen", "History": "Historie",
    "Request access": "Zugriff anfordern", "Design a new data product": "Neues Datenprodukt designen", "All requests": "Alle Anfragen", "My requests": "Meine Anfragen",
    "Waiting for my action": "Wartet auf mich", "Initiated by me": "Von mir gestartet", "My glossary terms": "Meine Glossarbegriffe", "My data assets (owner or steward)": "Meine Data Assets (Owner oder Steward)", "My role and assignments": "Meine Rolle und Zuordnungen",
    "Finished data products": "Fertige Datenprodukte", "Planned / requested data products": "Geplante / angeforderte Datenprodukte", "Process documentation (BPMN)": "Prozessdokumentation (BPMN)",
    "Attributes": "Attribute", "Lineage": "Lineage", "New attribute": "Neues Attribut", "Request business descriptions": "Fachliche Beschreibungen anfordern",
    "Tables": "Tabellen", "Schemas": "Schemata", "Databases": "Datenbanken", "Loading…": "Lädt…",
  },
  pl: {
    "My Dashboard": "Mój pulpit", "Import": "Import", "Export": "Eksport", "Glossary": "Słownik", "Marketplace": "Marketplace",
    "Discover Data Products": "Odkrywaj produkty danych", "Inbox": "Skrzynka", "Admin": "Admin", "Governance Overview": "Przegląd governance",
    "Users": "Użytkownicy", "Audit trail": "Dziennik audytu", "Dump": "Zrzut", "Restore": "Przywróć", "Export Glossary Terms": "Eksportuj pojęcia słownika",
    "Unity Catalog": "Unity Catalog", "Load source": "Wczytaj źródło", "Import CSV": "Importuj CSV", "Export CSV": "Eksportuj CSV", "Export OKF": "Eksportuj OKF", "Write back to UC": "Zapisz z powrotem do UC",
    "Search hubs, databases, schemas, tables, attributes…": "Szukaj hubów, baz, schematów, tabel, atrybutów…",
    "Help and feature guide": "Pomoc i przewodnik po funkcjach", "Sign out": "Wyloguj", "Security": "Bezpieczeństwo", "Language": "Język",
    "Sign in": "Zaloguj się", "Use your Alassio Data Catalog account.": "Użyj swojego konta Alassio Data Catalog.",
    "E-mail": "E-mail", "Password": "Hasło", "Password (min. 8 characters)": "Hasło (min. 8 znaków)", "Authenticator code": "Kod z aplikacji uwierzytelniającej", "Name": "Nazwa",
    "Create the first administrator": "Utwórz pierwszego administratora", "No accounts exist yet — this account will have the admin role.": "Nie ma jeszcze kont — to konto otrzyma rolę administratora.",
    "Create admin account": "Utwórz konto administratora", "Activate account": "Aktywuj konto", "Sign in with Microsoft": "Zaloguj się przez Microsoft", "or": "lub",
    "Data hubs": "Huby danych", "Data products": "Produkty danych", "Data owners": "Właściciele danych", "Data stewards": "Stewardzi danych", "Full lineage": "Pełny lineage", "New data hub": "Nowy hub danych",
    "Save": "Zapisz", "Cancel": "Anuluj", "Create": "Utwórz", "Edit": "Edytuj", "Delete": "Usuń", "Close": "Zamknij", "History": "Historia",
    "Request access": "Poproś o dostęp", "Design a new data product": "Zaprojektuj nowy produkt danych", "All requests": "Wszystkie wnioski", "My requests": "Moje wnioski",
    "Waiting for my action": "Czeka na moje działanie", "Initiated by me": "Zainicjowane przeze mnie", "My glossary terms": "Moje pojęcia słownika", "My data assets (owner or steward)": "Moje zasoby danych (właściciel lub steward)", "My role and assignments": "Moja rola i przypisania",
    "Finished data products": "Ukończone produkty danych", "Planned / requested data products": "Planowane / wnioskowane produkty danych", "Process documentation (BPMN)": "Dokumentacja procesów (BPMN)",
    "Attributes": "Atrybuty", "Lineage": "Lineage", "New attribute": "Nowy atrybut", "Request business descriptions": "Poproś o opisy biznesowe",
    "Tables": "Tabele", "Schemas": "Schematy", "Databases": "Bazy danych", "Loading…": "Ładowanie…",
  },
  es: {
    "My Dashboard": "Mi panel", "Import": "Importar", "Export": "Exportar", "Glossary": "Glosario", "Marketplace": "Marketplace",
    "Discover Data Products": "Descubrir productos de datos", "Inbox": "Bandeja de entrada", "Admin": "Admin", "Governance Overview": "Resumen de gobernanza",
    "Users": "Usuarios", "Audit trail": "Registro de auditoría", "Dump": "Volcado", "Restore": "Restaurar", "Export Glossary Terms": "Exportar términos del glosario",
    "Unity Catalog": "Unity Catalog", "Load source": "Cargar fuente", "Import CSV": "Importar CSV", "Export CSV": "Exportar CSV", "Export OKF": "Exportar OKF", "Write back to UC": "Escribir de vuelta en UC",
    "Search hubs, databases, schemas, tables, attributes…": "Buscar hubs, bases de datos, esquemas, tablas, atributos…",
    "Help and feature guide": "Ayuda y guía de funciones", "Sign out": "Cerrar sesión", "Security": "Seguridad", "Language": "Idioma",
    "Sign in": "Iniciar sesión", "Use your Alassio Data Catalog account.": "Usa tu cuenta de Alassio Data Catalog.",
    "E-mail": "Correo electrónico", "Password": "Contraseña", "Password (min. 8 characters)": "Contraseña (mín. 8 caracteres)", "Authenticator code": "Código del autenticador", "Name": "Nombre",
    "Create the first administrator": "Crear el primer administrador", "No accounts exist yet — this account will have the admin role.": "Aún no existen cuentas: esta cuenta tendrá el rol de administrador.",
    "Create admin account": "Crear cuenta de administrador", "Activate account": "Activar cuenta", "Sign in with Microsoft": "Iniciar sesión con Microsoft", "or": "o",
    "Data hubs": "Hubs de datos", "Data products": "Productos de datos", "Data owners": "Propietarios de datos", "Data stewards": "Data stewards", "Full lineage": "Linaje completo", "New data hub": "Nuevo hub de datos",
    "Save": "Guardar", "Cancel": "Cancelar", "Create": "Crear", "Edit": "Editar", "Delete": "Eliminar", "Close": "Cerrar", "History": "Historial",
    "Request access": "Solicitar acceso", "Design a new data product": "Diseñar un nuevo producto de datos", "All requests": "Todas las solicitudes", "My requests": "Mis solicitudes",
    "Waiting for my action": "Pendiente de mi acción", "Initiated by me": "Iniciado por mí", "My glossary terms": "Mis términos del glosario", "My data assets (owner or steward)": "Mis activos de datos (propietario o steward)", "My role and assignments": "Mi rol y asignaciones",
    "Finished data products": "Productos de datos terminados", "Planned / requested data products": "Productos de datos planificados / solicitados", "Process documentation (BPMN)": "Documentación del proceso (BPMN)",
    "Attributes": "Atributos", "Lineage": "Linaje", "New attribute": "Nuevo atributo", "Request business descriptions": "Solicitar descripciones de negocio",
    "Tables": "Tablas", "Schemas": "Esquemas", "Databases": "Bases de datos", "Loading…": "Cargando…",
  },
};

/* merge the dialog/view dictionaries into the shell dictionary; French and Italian ship as complete files */
for (const [l, m] of Object.entries(DICT_FULL)) DICT[l] = { ...(DICT[l] || {}), ...m };
DICT.fr = DICT_FR; DICT.it = DICT_IT;
for (const [l, m] of Object.entries(DICT_EXT)) DICT[l] = { ...(DICT[l] || {}), ...m };   /* translations added after the base dictionaries */
export const dictionaryFor = (lang) => DICT[lang] || {};

/* tn(["{n} table", "{n} tables"], n, vars) — v1.73: the singular key for exactly one, the plural key otherwise, translated
   and filled with { n, ...vars } (pass vars.n to show a formatted number while `n` picks the form) */
const makeTn = (t) => (forms, n, vars) => fill(t(pluralKey(forms[0], forms[1], n)), { n, ...vars });
const identity = (s) => s;
const Ctx = createContext({ lang: "en", t: identity, tn: makeTn(identity), setLang: () => {} });
export const detectLang = (user) => {
  const saved = user?.lang || (typeof localStorage !== "undefined" ? localStorage.getItem("cortex.lang") : null);
  if (saved && LANGS.some(([k]) => k === saved)) return saved;
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
  return LANGS.some(([k]) => k === nav) ? nav : "en";
};
/* v1.74 (F-F2 of the third review): tests can observe every key that has no translation in the active language —
   including keys passed through variables, which the static i18n-coverage check cannot see.
   reportMissingKeys(fn) installs the observer (fn(key, lang)), reportMissingKeys(null) removes it. */
let onMissing = null;
export const reportMissingKeys = (fn) => { onMissing = fn; };
const lookup = (lang, s) => {
  const v = DICT[lang]?.[s];
  if (v === undefined && onMissing && typeof s === "string" && s) onMissing(s, lang);
  return v ?? s;
};
export function I18nProvider({ initial = "en", children }) {
  const [lang, setLangState] = useState(initial);
  useEffect(() => { try { document.documentElement.lang = lang; } catch { } }, [lang]);   /* screen readers pick the right voice */
  const t = useCallback((s) => (lang === "en" ? s : lookup(lang, s)), [lang]);
  const tn = useMemo(() => makeTn(t), [t]);
  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem("cortex.lang", l); } catch { }
    apiPatch("/auth/me/lang", { lang: l }).catch(() => {});
  }, []);
  const value = useMemo(() => ({ lang, t, tn, setLang }), [lang, t, tn, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx);


/* Language switcher: a plain select showing the language codes (EN / DE / PL / ES / FR / IT) — deterministic on every platform. */
export function LangSwitchC({ lang, setLang, label = "Language" }) {
  const cur = LANGS.find(([k]) => k === lang) || LANGS[0];
  return (
    <select className="btn btn-ghost btn-sm" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={`${label}: ${cur[1]}`} title={cur[1]} style={{ padding: "2px 4px", fontWeight: 600 }}>
      {LANGS.map(([k, name]) => <option key={k} value={k} title={name}>{k.toUpperCase()}</option>)}
    </select>
  );
}
