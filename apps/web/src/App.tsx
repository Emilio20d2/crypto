import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Briefcase, LineChart, ArrowRightLeft, Wallet } from "lucide-react";
import { Portfolio } from "./pages/Portfolio";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Operaciones } from "./pages/Operaciones";
import { Mercado } from "./pages/Mercado";
import { Coinbase } from "./pages/Coinbase";
import logoUrl from "./assets/logo.svg";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const NAV_ITEMS = [
  { to: "/",            label: "Cartera",     icon: Briefcase },
  { to: "/mercado",     label: "Mercado",     icon: LineChart },
  { to: "/operaciones", label: "Operaciones", icon: ArrowRightLeft },
  { to: "/coinbase",    label: "Coinbase",    icon: Wallet },
];

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-container">
      {/* Sidebar — visible en escritorio */}
      <aside className="sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 24px", marginBottom: "32px" }}>
          <img src={logoUrl} alt="Crypto Control" style={{ width: 28, height: 28 }} />
          <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            Crypto Control
          </span>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "0 12px" }}>
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => `ui-nav-link ${isActive ? "active" : ""}`}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 16px",
                borderRadius: "var(--radius-sm)",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "var(--color-primary)" : "var(--text-secondary)",
                background: isActive ? "var(--bg-surface-active)" : "transparent",
                transition: "all var(--t-fast)"
              })}
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Contenido principal */}
      <main className="main-content">
        <div className="content-wrapper">
          {children}
        </div>
      </main>

      {/* Navegación inferior — solo móvil */}
      <nav className="mobile-nav">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            style={({ isActive }) => ({
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              textDecoration: "none",
              color: isActive ? "var(--color-primary)" : "var(--text-muted)",
              fontSize: "11px",
              fontWeight: isActive ? 600 : 500,
            })}
          >
            <Icon size={20} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

// Inyectamos algo de CSS para hover states de nav-links en escritorio
if (typeof document !== "undefined") {
  const styleEl = document.createElement("style");
  styleEl.innerHTML = `
    .ui-nav-link:hover:not(.active) {
      background: var(--bg-surface-hover) !important;
      color: var(--text-primary) !important;
    }
  `;
  document.head.appendChild(styleEl);
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Layout>
          <ErrorBoundary>
            <Routes>
              <Route path="/"            element={<Portfolio />} />
              <Route path="/mercado"     element={<Mercado />} />
              <Route path="/operaciones" element={<Operaciones />} />
              <Route path="/coinbase"    element={<Coinbase />} />
            </Routes>
          </ErrorBoundary>
        </Layout>
      </HashRouter>
    </QueryClientProvider>
  );
}
