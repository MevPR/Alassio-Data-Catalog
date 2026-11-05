import { useCatalogData, useNav, useActions } from "../catalog-context.jsx";
import { MyDashboardC } from "../components/my-dashboard.jsx";
import { DataProductStatusC } from "../components/data-product-status.jsx";
import { InboxViewC } from "../components/inbox.jsx";
import { MarketplaceViewC } from "../components/marketplace.jsx";
import { GlossaryViewC } from "../components/glossary.jsx";
import { UsersViewC, AuditViewC } from "../components/admin.jsx";
import { BackupsViewC } from "../components/backups.jsx";
import { HomeView } from "./home.jsx";
import { HubView, DataHubView } from "./hub-views.jsx";
import { DbView, SchemaView } from "./db-schema-views.jsx";
import { TableView } from "./table-view.jsx";
import { GovernanceView } from "./governance-view.jsx";
import { LineageView } from "./lineage-view.jsx";
import { SearchView } from "./search-view.jsx";

/* picks the view for the current navigation state (search › named views › selected catalog object). v1.73 (F-F8): the
   dashboard, marketplace and glossary read the contexts themselves instead of 13–14 props each. */
export function MainView() {
  const { state, me, isAdmin, isPm, isDataProduct } = useCatalogData();
  const { view, sel, query, setModal, openRef } = useNav();
  const { setUnread, openRequests } = useActions();

  if (query.trim()) return <SearchView />;
  switch (view) {
    case "audit": if (isAdmin) return <AuditViewC />; break;
    case "users": if (isAdmin) return <UsersViewC me={me} />; break;
    case "backups": if (isAdmin) return <BackupsViewC onRestoreJob={(job, fileName) => setModal({ kind: "restorejob", job, fileName })} />; break;
    case "inbox": return <InboxViewC refresh={setUnread} onOpenRequest={openRequests} onOpenTable={(id) => openRef({ type: "table", id, tab: "technical" })} />;
    case "mydash": return <MyDashboardC />;
    case "dpstatus": if (isAdmin || isPm) return <DataProductStatusC state={state} isDataProduct={isDataProduct} onOpenSchema={(id) => openRef({ type: "schema", id })} onOpenRequests={openRequests} />; break;
    case "marketplace": return <MarketplaceViewC />;
    case "glossary": return <GlossaryViewC />;
    case "governance": if (isAdmin) return <GovernanceView />; break;
    case "lineage": return <LineageView />;
    default: break;
  }
  switch (sel.type) {
    case "hub": return <HubView />;
    case "datahub": return <DataHubView />;
    case "database": return <DbView />;
    case "schema": return <SchemaView />;
    case "table": return <TableView />;
    default: return <HomeView />;
  }
}
