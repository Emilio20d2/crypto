import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Portfolio } from "./pages/Portfolio";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Operaciones } from "./pages/Operaciones";
import { Mercado } from "./pages/Mercado";
import { Coinbase } from "./pages/Coinbase";
import logoUrl from "./assets/logo.png";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const NAV_ITEMS = [
  { to: "/",            label: "Cartera",    icon: "💼" },
  { to: "/mercado",     label: "Mercado",    icon: "📈" },
  { to: "/operaciones", label: "Operaciones",icon: "📋" },
  { to: "/coinbase",    label: "Coinbase",   icon: "🔗" },
];

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      {/* Sidebar — visible en escritorio */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={logoUrl} alt="Crypto Control" />
          <span>Crypto Control</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}
            >
              <span style={{ fontSize: "1.1rem" }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Contenido principal */}
      <main className="main-content">
        {children}
      </main>

      {/* Navegación inferior — solo móvil */}
      <nav className="mobile-nav">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => isActive ? "mobile-nav-link active" : "mobile-nav-link"}
          >
            <span className="mobile-nav-icon">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
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
