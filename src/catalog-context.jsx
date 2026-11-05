import { createContext, useContext, useMemo } from "react";

/* The catalog UI's shared state, provided once by App.jsx in three contexts (v1.73 — finding F-F8; one context with
   117 keys re-rendered every reader on any change and could not be narrowed):
     CatalogDataContext  lookups (L), state, lazy, catVersion / catalogVersion, me + capabilities, perm, unread and the
                         derived lists (tableOptions, searchResults, mpProducts, …) — changes with the catalog only
     NavContext          view, sel, open, query, modal, tableTab, linSc, sFacet, mpPreset, glossaryFocus, railOpen, their
                         setters and openRef — changes when the user navigates
     ActionsContext      every action function (useStableCallbacks) — its value never changes identity
   Read them with useCatalogData() / useNav() / useActions(). useCatalog() still returns all three merged, so code that
   has not been narrowed yet keeps working; prefer the split hooks in new code. */
export const CatalogDataContext = createContext(null);
export const NavContext = createContext(null);
export const ActionsContext = createContext(null);

const need = (value, name) => {
  if (!value) throw new Error(`${name}() must be used inside the catalog providers (App.jsx, or renderWithCatalog() in tests)`);
  return value;
};
export const useCatalogData = () => need(useContext(CatalogDataContext), "useCatalogData");
export const useNav = () => need(useContext(NavContext), "useNav");
export const useActions = () => need(useContext(ActionsContext), "useActions");

/* the three contexts merged (pre-v1.73 shape) */
export const useCatalog = () => {
  const data = useCatalogData(), nav = useNav(), actions = useActions();
  return useMemo(() => ({ ...data, ...nav, ...actions }), [data, nav, actions]);
};

/* one provider for the three values — App.jsx and the test helper use it */
export function CatalogProviders({ data, nav, actions, children }) {
  return (
    <CatalogDataContext.Provider value={data}>
      <NavContext.Provider value={nav}>
        <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
      </NavContext.Provider>
    </CatalogDataContext.Provider>
  );
}
