import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { installCsrfFetch } from "./lib/csrf.js";
import { I18nProvider, detectLang, LANGS } from "./i18n.jsx";
import { CSS } from "./styles.js";
import { ManualPage } from "./views/manual.jsx";

installCsrfFetch();   /* state-changing fetches carry the CSRF token — see server/security.js */
/* v1.65: ?manual=1 renders the printable handbook instead of the app (static help texts, no sign-in needed) */
const params = new URLSearchParams(window.location.search);
const manualLang = params.get("lang");
const root = createRoot(document.getElementById("root"));
if (params.get("manual") === "1") root.render(<I18nProvider initial={LANGS.some(([l]) => l === manualLang) ? manualLang : detectLang(null)}><style>{CSS}</style><ManualPage /></I18nProvider>);
else root.render(<App />);
