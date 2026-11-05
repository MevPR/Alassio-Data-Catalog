/* Renders every modal and view with an empty catalog — a crash here is what users see as a white screen. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { afterEach as _ae } from "vitest";
_ae(cleanup);
import { cleanup, render } from "@testing-library/react";
import { UnityModalC, SourceModalC } from "../../src/components/source-import.jsx";
import { ExportModalC } from "../../src/components/export-modal.jsx";
import { EntityModalC } from "../../src/components/entity-modal.jsx";
import { EdgeMapModalC } from "../../src/components/lineage.jsx";
import { GlossaryTermModalC, GlossaryViewC } from "../../src/components/glossary.jsx";
import { MarketplaceViewC } from "../../src/components/marketplace.jsx";
import { MyDashboardC } from "../../src/components/my-dashboard.jsx";
import { InboxViewC } from "../../src/components/inbox.jsx";
import { AuthGateC, SecurityModalC } from "../../src/components/auth.jsx";
import { UsersViewC, AuditViewC, HistoryModalC } from "../../src/components/admin.jsx";
import { HelpModalC } from "../../src/components/help.jsx";
import { DataProductStatusC } from "../../src/components/data-product-status.jsx";
import { RoleBoxesC } from "../../src/components/role-boxes.jsx";
import { AgentKeysC, AgentKeysModalC } from "../../src/components/agent-keys.jsx";
import { renderWithCatalog } from "../helpers/catalog.jsx";
import { InviteAgentC, EntraSettingsC } from "../../src/components/admin-agents-sso.jsx";

const empty = { hubs: [], people: [], domains: [], databases: [], schemas: [], tables: [], attributes: [], lineage: [], glossary: [] };
const me = { id: "u", name: "Tester", email: "t@x.io", role: "admin" };
const noop = () => {};
beforeEach(() => { globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ requests: [], messages: [], unread: 0, users: [], invites: [], entries: [], total: 0, toAct: [], initiated: [], tasks: [], personIds: [], files: [], keys: [], enabled: false, buttonLabel: "", tenantId: "", clientId: "", clientSecret: "", redirectUri: "", defaultRoles: ["guest"] }) })); });

const cases = {
  UnityModalC: () => <UnityModalC hubs={[]} onClose={noop} onStarted={noop} />,
  SourceModalC: () => <SourceModalC sources={[]} onClose={noop} onImport={noop} />,
  ExportModalC: () => <ExportModalC hubs={[]} databases={[]} schemas={[]} tables={[]} attributes={[]} onExport={noop} onClose={noop} />,
  "EntityModalC hub": () => <EntityModalC modal={{ kind: "hub" }} hubs={[]} people={[]} domains={[]} onClose={noop} onSave={noop} />,
  "EntityModalC database": () => <EntityModalC modal={{ kind: "database" }} hubs={[]} people={[]} domains={[]} onClose={noop} onSave={noop} />,
  "EntityModalC schema": () => <EntityModalC modal={{ kind: "schema", parentId: "d" }} hubs={[]} people={[]} domains={[]} onClose={noop} onSave={noop} />,
  "EntityModalC table": () => <EntityModalC modal={{ kind: "table", parentId: "s" }} hubs={[]} people={[]} domains={[]} onClose={noop} onSave={noop} />,
  "EntityModalC attribute": () => <EntityModalC modal={{ kind: "attribute", parentId: "t" }} hubs={[]} people={[]} domains={[]} onClose={noop} onSave={noop} />,
  "EntityModalC domain": () => <EntityModalC modal={{ kind: "domain" }} hubs={[]} people={[]} domains={[]} onClose={noop} onSave={noop} />,
  "EntityModalC person": () => <EntityModalC modal={{ kind: "person" }} hubs={[]} people={[]} domains={[]} onClose={noop} onSave={noop} />,
  "EntityModalC edge": () => <EntityModalC modal={{ kind: "edge" }} hubs={[]} people={[]} domains={[]} tableOptions={[]} onClose={noop} onSave={noop} />,
  EdgeMapModalC: () => <EdgeMapModalC edge={{ id: "e", from: "a", to: "b", mappings: [] }} fromTable={{ id: "a", name: "a" }} toTable={{ id: "b", name: "b" }} fromPath="x.a" toPath="x.b" fromAttrs={[]} toAttrs={[]} canEdit={true} onAdd={noop} onRemove={noop} onOpen={noop} onClose={noop} />,
  GlossaryTermModalC: () => <GlossaryTermModalC refOptions={{}} refLabel={() => ""} onSave={noop} onClose={noop} />,
  InboxViewC: () => <InboxViewC refresh={noop} onOpenRequest={noop} onOpenTable={noop} />,
  "AuthGateC login": () => <AuthGateC screen={{ mode: "login" }} onAuthed={noop} />,
  "AuthGateC bootstrap": () => <AuthGateC screen={{ mode: "bootstrap" }} onAuthed={noop} />,
  SecurityModalC: () => <SecurityModalC me={me} onClose={noop} onChanged={noop} />,
  UsersViewC: () => <UsersViewC me={me} flash={noop} />,
  AuditViewC: () => <AuditViewC />,
  HistoryModalC: () => <HistoryModalC scopeId="x" title="x" canEdit={true} onClose={noop} onRestore={noop} />,
  HelpModalC: () => <HelpModalC isAdmin={true} onClose={noop} />,
  RoleBoxesC: () => <RoleBoxesC onOpenUsers={noop} />,
  InviteAgentC: () => <InviteAgentC onCreated={noop} flash={noop} />,
  EntraSettingsC: () => <EntraSettingsC flash={noop} />,
  AgentKeysC: () => <AgentKeysC base="/auth/me/keys" revokeBase="/auth/me/keys" title="keys" flash={noop} />,
  AgentKeysModalC: () => <AgentKeysModalC user={{ id: "u", name: "Bot" }} onClose={noop} flash={noop} />,
  "SecurityModalC agent": () => <SecurityModalC me={{ ...me, role: "agent", roles: ["agent"] }} onClose={noop} onChanged={noop} flash={noop} />,
  DataProductStatusC: () => <DataProductStatusC state={empty} isDataProduct={() => false} onOpenSchema={noop} onOpenRequests={noop} />,
};

/* v1.73 (F-F8): these read the catalog contexts instead of props */
const contextCases = {
  GlossaryViewC: () => <GlossaryViewC />,
  MarketplaceViewC: () => <MarketplaceViewC />,
  "MarketplaceViewC (preset)": () => <MarketplaceViewC />,
  MyDashboardC: () => <MyDashboardC />,
};
const contextOpts = { "MarketplaceViewC (preset)": { nav: { mpPreset: { tab: "requests" } } } };

describe("smoke: every dialog and view renders on an empty catalog", () => {
  for (const [name, make] of Object.entries(cases)) {
    it(name, () => { expect(() => render(make())).not.toThrow(); });
  }
  for (const [name, make] of Object.entries(contextCases)) {
    it(name, () => { expect(() => renderWithCatalog(make(), { me, ...contextOpts[name] })).not.toThrow(); });
  }
});
