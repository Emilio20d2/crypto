import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, KeyRound, MonitorCog, Settings, Shield, SlidersHorizontal } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/Card";
import { CoinbaseSettingsPanel } from "../components/CoinbasePanels";
import { LoadingState } from "../components/LoadingState";
import { PageToolbar } from "../components/PageToolbar";
import { Select } from "../components/Select";
import { SettingsList, SettingsRow } from "../components/SettingsPanels";

function DiagnosticsPanel() {
  const [backfilling, setBackfilling] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["diagnostics:getReport"],
    queryFn: async () => {
      const result = await window.cryptoControl.diagnostics.getReport();
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    staleTime: 30_000,
  });

  async function handleBackfill() {
    setBackfilling(true);
    try {
      await window.cryptoControl.portfolio.backfillCostBasis();
      await refetch();
    } finally {
      setBackfilling(false);
    }
  }

  if (isLoading) return <LoadingState message="Cargando diagnóstico..." />;
  if (isError || !data) return <p className="empty-inline">Error al cargar el diagnóstico.</p>;

  const renderedAssets = data.perAsset.filter((a) => a.rendered);

  return (
    <>
      <SettingsRow
        label="Transacciones"
        description="Total de registros procesados en la base de datos"
        control={<Badge>{data.transactions.toLocaleString("es-ES")}</Badge>}
      />
      <SettingsRow
        label="Posiciones con precio"
        description="Activos que resuelven precio de mercado"
        control={
          <Badge variant={data.missingPrices === 0 ? "success" : undefined}>
            {data.positions - data.missingPrices} / {data.positions}
          </Badge>
        }
      />
      <SettingsRow
        label="Sin coste base"
        description="Legs de transacción sin valoración"
        control={
          <Badge variant={data.missingCosts === 0 ? "success" : undefined}>
            {data.missingCosts}
          </Badge>
        }
      />
      <SettingsRow
        label="Backfill de coste"
        description="Rellenar valoraciones pendientes usando histórico de mercado"
        control={
          <Button type="button" variant="secondary" size="sm" loading={backfilling} onClick={handleBackfill}>
            Ejecutar ahora
          </Button>
        }
      />
      {renderedAssets.length > 0 && (
        <div className="diagnostics-asset-list">
          {renderedAssets.map((asset) => (
            <div key={asset.symbol} className="diagnostics-asset-row">
              <span className="diagnostics-asset-symbol">{asset.symbol}</span>
              <span className={asset.hasPrice ? "text-positive" : "text-negative"}>
                {asset.hasPrice ? "Precio ✓" : "Sin precio"}
              </span>
              <span className={asset.hasHistoricalPrice ? "text-positive" : "text-negative"}>
                {asset.hasHistoricalPrice ? "Histórico ✓" : "Sin histórico"}
              </span>
              <span className={asset.hasCostBasis ? "text-positive" : "text-negative"}>
                {asset.hasCostBasis ? "Coste ✓" : "Sin coste"}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const SECTIONS = [
  { id: "general", label: "General", icon: <Settings size={16} /> },
  { id: "datos", label: "Datos", icon: <Database size={16} /> },
  { id: "mercado", label: "Mercado", icon: <SlidersHorizontal size={16} /> },
  { id: "coinbase", label: "Coinbase", icon: <KeyRound size={16} /> },
  { id: "seguridad", label: "Seguridad", icon: <Shield size={16} /> },
  { id: "diagnostico", label: "Diagnóstico", icon: <MonitorCog size={16} /> },
] as const;

type SettingsSectionId = typeof SECTIONS[number]["id"];

function isSettingsSectionId(value?: string): value is SettingsSectionId {
  return SECTIONS.some((section) => section.id === value);
}

export function Configuracion() {
  const navigate = useNavigate();
  const params = useParams();
  const active: SettingsSectionId = isSettingsSectionId(params.section) ? params.section : "general";
  const activeSection = useMemo(() => SECTIONS.find((section) => section.id === active) ?? SECTIONS[0], [active]);
  const selectSection = (sectionId: string) => {
    navigate(sectionId === "general" ? "/configuracion" : `/configuracion/${sectionId}`);
  };

  return (
    <section className="page-stack settings-page">
      <PageToolbar title="Configuración" meta="Preferencias y diagnóstico local" />
      <div className="settings-mobile-selector">
        <Select value={active} onChange={(event) => selectSection(event.target.value)}>
          {SECTIONS.map((section) => (
            <option key={section.id} value={section.id}>{section.label}</option>
          ))}
        </Select>
      </div>
      <div className="settings-layout">
        <SettingsList sections={SECTIONS} active={active} onSelect={selectSection} />
        {active === "coinbase" ? (
          <section className="settings-panel-stack">
            <div className="settings-panel-heading">
              <h2>{activeSection.label}</h2>
              <p>Conexión, credenciales, permisos, sincronización e historial.</p>
            </div>
            <CoinbaseSettingsPanel />
          </section>
        ) : (
          <Card className="settings-panel">
            <CardHeader>
              <CardTitle>{activeSection.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {active === "general" && (
                <>
                  <SettingsRow label="Divisa principal" description="Moneda usada para valorar la cartera" control={<Select defaultValue="EUR"><option value="EUR">Euro (EUR)</option></Select>} />
                  <SettingsRow label="Página inicial" description="Vista que se abre al iniciar la app" control={<Select defaultValue="cartera"><option value="cartera">Cartera</option></Select>} />
                  <SettingsRow label="Densidad" description="Compacta para uso financiero repetido" control={<Badge variant="success">Compacta</Badge>} />
                </>
              )}

              {active === "datos" && (
                <>
                  <SettingsRow label="Base de datos" description="SQLite local en el perfil de la app" control={<Badge>Local</Badge>} />
                  <SettingsRow label="Migraciones" description="Se aplican al iniciar Electron" control={<Badge variant="success">Activas</Badge>} />
                  <SettingsRow label="Copia de seguridad" description="Respaldo externo creado antes de esta reconstrucción" control={<Badge variant="success">Creado</Badge>} />
                </>
              )}

              {active === "mercado" && (
                <>
                  <SettingsRow label="Proveedor preferente" description="Coinbase con fallback de mercado configurado" control={<Select defaultValue="auto"><option value="auto">Automático</option></Select>} />
                  <SettingsRow label="Periodos" description="1h, 1d, 1s, 1m, 1a y Todo" control={<Badge variant="success">Disponibles</Badge>} />
                  <SettingsRow label="Caché" description="Se usa cuando no hay dato live" control={<Badge>Local</Badge>} />
                  <SettingsRow label="Sentimiento" description="Calculado localmente con histórico, cobertura y confianza" control={<Badge variant="success">Activo</Badge>} />
                </>
              )}

              {active === "seguridad" && (
                <>
                  <SettingsRow label="Credenciales" description="Gestionadas por el Llavero de macOS" control={<Badge variant="success">Llavero</Badge>} />
                  <SettingsRow label="Secretos en renderer" description="No se exponen claves al frontend" control={<Badge variant="success">No</Badge>} />
                  <SettingsRow label="Permiso recomendado" description="Solo lectura en Coinbase CDP" control={<Badge>View</Badge>} />
                </>
              )}

              {active === "diagnostico" && <DiagnosticsPanel />}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
