import { lazy, Suspense } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BUILD_INFO } from "./lib/buildInfo";
import { ArrowRightLeft, BriefcaseBusiness, ChartNoAxesCombined, Landmark, LineChart, Receipt, Settings, Target } from "lucide-react";
import { AppShell, type NavigationItem } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Portfolio } from "./pages/Portfolio";

// Heavy pages loaded on demand — never parsed on startup
const Mercado        = lazy(() => import("./pages/Mercado").then(m => ({ default: m.Mercado })));
const Operaciones    = lazy(() => import("./pages/Operaciones").then(m => ({ default: m.Operaciones })));
const AssetDetail    = lazy(() => import("./pages/AssetDetail").then(m => ({ default: m.AssetDetail })));
const Configuracion  = lazy(() => import("./pages/Configuracion").then(m => ({ default: m.Configuracion })));
const Fiscalidad     = lazy(() => import("./pages/Fiscalidad").then(m => ({ default: m.Fiscalidad })));
const PlanInversion  = lazy(() => import("./pages/PlanInversion").then(m => ({ default: m.PlanInversion })));
const Tesoreria      = lazy(() => import("./pages/Tesoreria").then(m => ({ default: m.Tesoreria })));
const Perspectivas   = lazy(() => import("./pages/Perspectivas").then(m => ({ default: m.Perspectivas })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 60_000,
    },
  },
});

// Build identity — visible in browser console and Configuración > Diagnóstico
console.log(
  `%c[BUILD] commit=${BUILD_INFO.commitShort} branch=${BUILD_INFO.branch} builtAt=${BUILD_INFO.builtAt}`,
  "color:#6366f1;font-weight:bold"
);

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

function PageFallback() {
  return (
    <section className="page-stack" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200 }}>
      <span style={{ color: "var(--color-text-muted, #888)", fontSize: "0.85rem" }}>Cargando…</span>
    </section>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppShell items={NAV_ITEMS}>
          <ErrorBoundary>
            <Suspense fallback={<PageFallback />}>
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
            </Suspense>
          </ErrorBoundary>
        </AppShell>
      </HashRouter>
    </QueryClientProvider>
  );
}
