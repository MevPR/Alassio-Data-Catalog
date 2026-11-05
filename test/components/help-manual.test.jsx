/* v1.65 — figures, examples and tips render in the help dialog; the handbook page renders cover, contents and chapters */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n.jsx";
import { HelpModalC } from "../../src/components/help.jsx";
import { ManualPage } from "../../src/views/manual.jsx";

afterEach(cleanup);

describe("help handbook", () => {
  it("shows the hierarchy figure, the worked example and tips in the catalog chapter (German)", () => {
    render(<I18nProvider initial="de"><HelpModalC isAdmin roles={["admin"]} initialChapter="catalog" onClose={() => {}} /></I18nProvider>);
    const figs = screen.getAllByRole("img");
    expect(figs.some((f) => f.getAttribute("aria-label").includes("Kataloghierarchie"))).toBe(true);
    expect(screen.getByText(/Beispiel — Einen neuen Data Hub einrichten/)).toBeTruthy();
    expect(screen.getAllByText("Tipps").length).toBeGreaterThan(0);
    expect(screen.getByText(/SALES_DE/, { selector: "b" })).toBeTruthy();   /* bold in the example renders */
    const link = screen.getByRole("link", { name: /Als Handbuch öffnen/ });
    expect(link.getAttribute("href")).toBe("?manual=1&lang=de"); expect(link.getAttribute("target")).toBe("_blank");
  });
  it("renders the workflow figure with the three phases in the products chapter and finds examples via search", () => {
    render(<I18nProvider initial="en"><HelpModalC isAdmin={false} roles={["pm"]} initialChapter="products" onClose={() => {}} /></I18nProvider>);
    expect(screen.getByRole("img", { name: /three phases, ten steps/ })).toBeTruthy();
    expect(screen.getByText(/Example — A data product from design to sign-off/)).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "permission matrix" } });
    expect(screen.queryByText(/Example — Permission matrix/)).toBeTruthy();
  });
  it("the handbook page has a cover, a table of contents with every chapter and all figures", () => {
    render(<I18nProvider initial="fr"><ManualPage /></I18nProvider>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Alassio Data Catalog — Manuel");
    const toc = screen.getByRole("navigation", { name: "Sommaire" });
    expect(within(toc).getAllByRole("link").length).toBeGreaterThan(40);
    expect(within(toc).getByText(/Administration/)).toBeTruthy();   /* admin chapter is documentation */
    expect(screen.getAllByRole("img").length).toBe(8);              /* every figure once (hierarchy section shows two) */
    expect(screen.getByRole("button", { name: /Imprimer/ })).toBeTruthy();
    expect(screen.getByText(/Exemple — Un profil de synchronisation/)).toBeTruthy();
  });
});
