/* v1.74 (F-F2 of the third review): runtime translation check. The static i18n-coverage test reads literals in t(…);
   keys passed through variables (screen titles from a lookup table, source-connector labels, role labels, step-dialog
   placeholders) were invisible to it, so the invitation screen title and "Verify code" stayed English. Here the main
   screens are rendered in German with an observer on the dictionary lookup: every key t() could not translate fails. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider, reportMissingKeys } from "../../src/i18n.jsx";
import { AuthGateC } from "../../src/components/auth.jsx";
import { SourceModalC, UnityModalC } from "../../src/components/source-import.jsx";
import { SOURCE_TYPES } from "../../src/lib/source-types.js";
import { UsersViewC } from "../../src/components/admin.jsx";
import App from "../../src/App.jsx";
import { ToastStub } from "../helpers/toast.jsx";
import { okJson as ok, appShellFetch } from "../helpers/fetch.js";

/* keys that are deliberately language-neutral: product names, formats, codes, and example values in placeholders
   (a single token with technical characters, all-lowercase identifiers, URLs) */
const NEUTRAL = /^(MySQL \/ MariaDB|Microsoft SQL Server \/ Azure SQL|IBM DB2|SAP HANA|Alassio Data Catalog|Unity Catalog|OKF|CSV|JSON|URL|DuckDB|OData|SAP|MCP|SQL|PAT|ODCS|dbt|JDBC|SQLAlchemy|Kafka|Power BI|Informatica|SuccessFactors|Snowflake|Oracle|DB2|MySQL|PostgreSQL|SQL Server|MariaDB|Delta|Parquet|Avro|123456)$/;
const EXAMPLE = (k) => /:\/\//.test(k) || /X{4,}/.test(k) || (/^\S+$/.test(k) && (/[./:@_+*\d-]/.test(k) || k === k.toLowerCase())) || /^dbt \S+\.json$/.test(k) || /^[A-Z]_\w+(, [A-Z]_\w+)*$/.test(k) || k === "Claims Analytics, Finance*";
let missing;
beforeEach(() => { missing = new Set(); reportMissingKeys((k, lang) => { if (lang === "de" && !NEUTRAL.test(k) && !EXAMPLE(k) && /[A-Za-z]{2}/.test(k)) missing.add(k); }); });
afterEach(() => { reportMissingKeys(null); cleanup(); vi.unstubAllGlobals(); });
const de = (ui) => render(<I18nProvider initial="de">{ui}</I18nProvider>);
const expectAllTranslated = () => { if (process.env.I18N_DUMP) console.log("MISSING " + JSON.stringify([...missing].sort())); expect([...missing].sort()).toEqual([]); };

describe("German walk-through: every rendered key has a translation", () => {
  it("sign-in gate: login, invitation, reset, forgot, header, bootstrap, authenticator code", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u) => String(u).includes("reset-info") ? ok({ email: "a@x.io" }) : String(u).includes("/auth/login") ? ok({ need2fa: true }) : ok({ enabled: false })));
    for (const entry of [{ mode: "login", mail: true }, { mode: "invite", token: "t" }, { mode: "reset", token: "t" }, { mode: "header" }, { mode: "bootstrap" }]) {
      const { unmount } = de(<AuthGateC screen={entry} onAuthed={() => {}} />);
      await act(async () => {});
      unmount();
    }
    de(<AuthGateC screen={{ mode: "login", mail: true }} onAuthed={() => {}} />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("E-Mail"), { target: { value: "a@x.io" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "secret123" } });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Anmelden/ }).at(-1)); });
    expect(await screen.findByLabelText("Authenticator-Code")).toBeTruthy();   /* the totp screen */
    expectAllTranslated();
  });
  it("Load source: every connector form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ native: ["odata", "kafka", "powerbi", "informatica", "successfactors"], inspectorModes: ["duckdb", "lakefiles", "sqlalchemy", "jdbc"], inspector: true, inspectorReachable: true })));
    de(<SourceModalC sources={[]} onClose={() => {}} onImport={() => {}} />);
    await act(async () => {});
    const select = screen.getAllByRole("combobox")[0];
    for (const key of Object.keys(SOURCE_TYPES)) { fireEvent.change(select, { target: { value: key } }); await act(async () => {}); }
    expectAllTranslated();
  });
  it("admin: user management with roles and invitations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ users: [{ id: "u2", name: "Pat", email: "pat@x.io", role: "guest", roles: ["guest", "steward", "pm", "ba", "ingestion", "dpd"], passwordAuth: true, totp: true }, { id: "u3", name: "Sam", email: "sam@x.io", role: "admin", roles: ["admin"], sso: true }], invites: [{ email: "new@x.io", role: "guest", roles: ["guest"], expires: Date.now() + 864e5 }] })));
    de(<ToastStub><UsersViewC me={{ id: "u1", name: "Me", email: "me@x.io", role: "admin", roles: ["admin"] }} /></ToastStub>);
    expect(await screen.findByText("pat@x.io")).toBeTruthy();
    expectAllTranslated();
  });
  it("Unity Catalog import dialog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ profiles: [] })));
    de(<UnityModalC hubs={[{ id: "central", name: "Central" }]} onClose={() => {}} onStarted={() => {}} />);
    await act(async () => {});
    expectAllTranslated();
  });
  it("the signed-in application shell (home, rail, top bar)", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(appShellFetch({ me: { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"], lang: "de", capabilities: { admin: true, pm: true } },
      catalog: { hubs: [{ id: "h", name: "Health" }, { id: "source", name: "SOURCE" }], databases: [{ id: "d", name: "GOLD", hubId: "h", layer: "gold", country: "DE" }], schemas: [], tables: [], attributes: [], domains: [], people: [], lineage: [], glossary: [] } })));
    render(<App />);
    expect(await screen.findByText("Mein Dashboard")).toBeTruthy();
    await act(async () => {});
    expectAllTranslated();
  });
});
