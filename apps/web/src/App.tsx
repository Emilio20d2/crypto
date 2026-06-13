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

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={logoUrl} alt="Logo" />
          <span>Crypto Control</span>
        </div>
        <nav>
          <NavLink to="/" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Cartera</NavLink>
          <NavLink to="/mercado" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Mercado</NavLink>
          <NavLink to="/operaciones" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Operaciones</NavLink>
          <NavLink to="/coinbase" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Coinbase</NavLink>
        </nav>
      </aside>
      <main className="main-content">
        {children}
      </main>
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
              <Route path="/" element={<Portfolio />} />
              <Route path="/mercado" element={<Mercado />} />
              <Route path="/operaciones" element={<Operaciones />} />
              <Route path="/coinbase" element={<Coinbase />} />
            </Routes>
          </ErrorBoundary>
        </Layout>
      </HashRouter>
    </QueryClientProvider>
  );
}
