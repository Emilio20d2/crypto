import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { Portfolio } from "./pages/Portfolio";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Operaciones } from "./pages/Operaciones";

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/logo.png" alt="Logo" />
          <span>Crypto Control</span>
        </div>
        <nav>
          <NavLink to="/" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}>Cartera</NavLink>
          <NavLink to="/operaciones" className={({isActive}) => isActive ? "nav-link active" : "nav-link"}>Operaciones</NavLink>
        </nav>
      </aside>
      <main className="main-content">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Portfolio />} />
          <Route path="/operaciones" element={<Operaciones />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}

export default App;
