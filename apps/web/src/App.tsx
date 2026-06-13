import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Portfolio } from "./pages/Portfolio";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Operaciones } from "./pages/Operaciones";
import { Mercado } from "./pages/Mercado";

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/logo.png" alt="Logo" />
          <span>Crypto Control</span>
        </div>
        <nav>
          <NavLink to="/" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Cartera</NavLink>
          <NavLink to="/mercado" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Mercado</NavLink>
          <NavLink to="/operaciones" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Operaciones</NavLink>
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
    <HashRouter>
      <Layout>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Portfolio />} />
            <Route path="/mercado" element={<Mercado />} />
            <Route path="/operaciones" element={<Operaciones />} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </HashRouter>
  );
}
