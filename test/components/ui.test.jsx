import { describe, it, expect, vi } from "vitest";
import { afterEach as _ae } from "vitest";
_ae(cleanup);
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { MenuC, Modal } from "../../src/components/ui.jsx";
import { GlossaryTermModalC } from "../../src/components/glossary.jsx";
import { HelpModalC } from "../../src/components/help.jsx";

describe("MenuC", () => {
  it("renders nothing when no entry is allowed for the role", () => {
    const { container } = render(<MenuC label="Admin" icon={null} items={[false, false]} />);
    expect(container.innerHTML).toBe("");
  });
  it("opens on click and triggers the entry", () => {
    const onClick = vi.fn();
    render(<MenuC label="Export" icon={null} items={[{ label: "Export CSV", icon: null, onClick }]} />);
    fireEvent.click(screen.getByText("Export"));
    fireEvent.click(screen.getByText("Export CSV"));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("Modal", () => {
  it("shows title and calls onClose", () => {
    const onClose = vi.fn();
    render(<Modal title="Hello" onClose={onClose}><p>body</p></Modal>);
    expect(screen.getByText("Hello")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("GlossaryTermModalC", () => {
  it("requires a name and submits references and links", () => {
    const onSave = vi.fn();
    render(<GlossaryTermModalC refOptions={{ table: [{ id: "t1", label: "GOLD.partners.loss_ratio" }] }} refLabel={() => "GOLD.partners.loss_ratio"} onSave={onSave} onClose={() => {}} />);
    const create = screen.getByText("Create");
    expect(create.closest("button").disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("e.g. Loss ratio"), { target: { value: "Loss ratio" } });
    fireEvent.change(screen.getByPlaceholderText("https://…"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByText("Add"));
    fireEvent.click(create);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Loss ratio", urls: [{ name: "https://example.com", url: "https://example.com" }] }));
  });
});

describe("HelpModalC", () => {
  it("shows the Administration chapter only for admins and opens chapters from the navigation", () => {
    const { unmount } = render(<HelpModalC isAdmin={false} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /Administration/ })).toBeNull();
    expect(screen.getByRole("heading", { level: 4, name: "Getting started" })).toBeTruthy();
    unmount();
    render(<HelpModalC isAdmin={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Administration/ }));
    expect(screen.getByText("Admin menu (Admins only)")).toBeTruthy();
  });
});

describe("UsersViewC role editing", () => {
  it("shows only the active roles in the row and edits roles via the dialog dropdown", async () => {
    const { UsersViewC } = await import("../../src/components/admin.jsx");
    globalThis.fetch = vi.fn(async (url, opts) => ({ ok: true, status: 200, json: async () => (
      String(url).includes("/admin/users") && (!opts || !opts.method || opts.method === "GET") ? { users: [{ id: "u2", name: "Multi Role", email: "m@x.io", role: "pm", roles: ["pm", "ingestion"], totpEnabled: false }], invites: [] } : { user: {} }) }));
    const me = { id: "u1", name: "Admin", email: "a@x.io", role: "admin", roles: ["admin"] };
    const { findByText, getByLabelText } = render(<UsersViewC me={me} flash={() => {}} />);
    const nameEl = await findByText("Multi Role");
    const row = nameEl.closest(".role-row") || nameEl.parentElement.parentElement;
    const chips = within(row).getAllByText(/project manager|data ingestion|business analyst|guest|steward|admin/i).map((e) => e.textContent);
    expect(chips.some((t) => /project manager/i.test(t))).toBe(true);
    expect(chips.some((t) => /business analyst|guest/i.test(t))).toBe(false);   // inactive roles are not shown in the row
    fireEvent.click(getByLabelText("Edit Multi Role"));
    fireEvent.click(getByLabelText("Roles"));                                  // opens the multi-select dropdown in the dialog
    expect(within(screen.getByRole("listbox")).getAllByRole("checkbox").length).toBe(8); // all roles (incl. Agent) offered inside the dropdown
  });
});

describe("EntityModalC — data hub from the catalog tree (v1.63)", () => {
  it("offers the data hub type as a select when opened without a type, shows it as text when opened from a type page, and translates the title", async () => {
    const { EntityModalC } = await import("../../src/components/entity-modal.jsx");
    const { I18nProvider } = await import("../../src/i18n.jsx");
    const hubs = [{ id: "h1", name: "Health" }, { id: "h2", name: "P&C" }];
    const onSave = vi.fn();
    const { unmount } = render(<EntityModalC modal={{ kind: "datahub" }} hubs={hubs} people={[]} domains={[]} onClose={() => {}} onSave={onSave} />);
    expect(screen.getByRole("dialog", { name: "New data hub" })).toBeTruthy();
    const sel = screen.getByLabelText("Data hub type");
    expect(sel.tagName).toBe("SELECT"); expect(sel.value).toBe("h1");
    fireEvent.change(sel, { target: { value: "h2" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "PC_DE_USR" } });
    fireEvent.click(screen.getByRole("button", { name: "Create data hub" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ hubId: "h2", name: "PC_DE_USR" }));
    unmount();
    render(<I18nProvider initial="de"><EntityModalC modal={{ kind: "datahub", hubTypeId: "h2" }} hubs={hubs} people={[]} domains={[]} onClose={() => {}} onSave={onSave} /></I18nProvider>);
    expect(screen.getByRole("dialog", { name: "Neuer Data Hub" })).toBeTruthy();
    expect(screen.queryByLabelText("Data Hub Type")).toBeNull();
    expect(screen.getByText("P&C")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Data Hub anlegen" })).toBeTruthy();
  });
});
