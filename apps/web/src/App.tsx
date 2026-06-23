import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowRightLeft, BriefcaseBusiness, ChartNoAxesCombined, Landmark, LineChart, Receipt, Settings, Target } from "lucide-react";
import { AppShell, type NavigationItem } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Portfolio } from "./pages/Portfolio";
import { Mercado } from "./pages/Mercado";
import { Operaciones } from "./pages/Operaciones";
import { AssetDetail } from "./pages/AssetDetail";
import { Configuracion } from "./pages/Configuracion";
import { Fiscalidad } from "./pages/Fiscalidad";
import { PlanInversion } from "./pages/PlanInversion";
import { Tesoreria } from "./pages/Tesoreria";
import { Perspectivas } from "./pages/Perspectivas";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const NAV_ITEMS: NavigationItem[] = [
  { to: "/cartera", label: "Cartera", icon: BriefcaseBusiness, end: true },
  { to: "/mercado", label: "Mercado", icon: LineChart },
  { to: "/operaciones", label: "Operaciones", icon: ArrowRightLeft },
  { to: "/fiscalidad", label: "Fiscalidad", icon: Receipt },
  { to: "/plan-inversion", label: "Plan", icon: Target },
  { to: "/tesoreria", label: "Tesorería", icon: Landmark },
  { to: "/perspectivas", label: "Perspectivas", icon: ChartNoAxesCombined },
  { to: "/configuracion", label: "Configuración", icon: Settings },
];

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppShell items={NAV_ITEMS}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/cartera" replace />} />
              <Route path="/cartera" element={<Portfolio />} />
              <Route path="/mercado" element={<Mercado />} />
              <Route path="/activo/:assetId" element={<AssetDetail />} />
              <Route path="/operaciones" element={<Operaciones />} />
              <Route path="/fiscalidad" element={<Fiscalidad />} />
              <Route path="/plan-inversion/*" element={<PlanInversion />} />
              <Route path="/tesoreria" element={<Tesoreria />} />
              <Route path="/perspectivas" element={<Perspectivas />} />
              <Route path="/configuracion" element={<Configuracion />} />
              <Route path="/configuracion/:section" element={<Configuracion />} />
              <Route path="/coinbase" element={<Navigate to="/configuracion/coinbase" replace />} />
              <Route path="*" element={<Navigate to="/cartera" replace />} />
            </Routes>
          </ErrorBoundary>
        </AppShell>
      </HashRouter>
    </QueryClientProvider>
  );
}
