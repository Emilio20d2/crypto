import { useState, type ComponentType, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import logoUrl from "../assets/logo.png";

export type NavigationItem = {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  end?: boolean;
};

function SidebarContents({ items, onNavigate }: { items: NavigationItem[]; onNavigate?: () => void }) {
  return (
    <>
      <div className="sidebar-brand">
        <img src={logoUrl} alt="Crypto Control" />
        <strong>Crypto Control</strong>
      </div>
      <nav className="sidebar-nav" aria-label="Principal">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
            <Icon size={17} strokeWidth={2.1} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export function NativeSidebar({ items }: { items: NavigationItem[] }) {
  return (
    <aside className="native-sidebar">
      <SidebarContents items={items} />
    </aside>
  );
}

export function MobileNavigation({ items }: { items: NavigationItem[] }) {
  return (
    <nav className="mobile-nav" aria-label="Principal">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `mobile-nav-link ${isActive ? "active" : ""}`}>
          <Icon size={19} strokeWidth={2.1} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function MobileTopbar({ activeLabel, onOpen }: { activeLabel: string; onOpen: () => void }) {
  return (
    <header className="mobile-topbar">
      <button type="button" className="icon-button mobile-sidebar-button" onClick={onOpen} aria-label="Abrir navegación">
        <Menu size={20} />
      </button>
      <span className="mobile-topbar-brand">
        <img src={logoUrl} alt="" aria-hidden="true" />
        <strong>Crypto Control</strong>
      </span>
      <span className="mobile-topbar-section">{activeLabel}</span>
    </header>
  );
}

function MobileSidebarDrawer({ items, open, onClose }: { items: NavigationItem[]; open: boolean; onClose: () => void }) {
  return (
    <div className={`mobile-sidebar-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <button type="button" className="mobile-sidebar-backdrop" onClick={onClose} aria-label="Cerrar navegación" />
      <aside className="mobile-sidebar-drawer" aria-label="Navegación lateral móvil">
        <button type="button" className="icon-button mobile-sidebar-close" onClick={onClose} aria-label="Cerrar navegación">
          <X size={18} />
        </button>
        <SidebarContents items={items} onNavigate={onClose} />
      </aside>
    </div>
  );
}

// Detect Electron via user-agent — browser clients don't have "Electron" in UA
const isElectron = typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);

export function AppShell({ items, children }: { items: NavigationItem[]; children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const activeItem = items
    .filter((item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))
    .sort((a, b) => b.to.length - a.to.length)[0];

  return (
    <div className="app-shell" data-platform={isElectron ? "electron" : "web"}>
      <NativeSidebar items={items} />
      <MobileTopbar activeLabel={activeItem?.label ?? "Crypto Control"} onOpen={() => setSidebarOpen(true)} />
      <main className="app-main">
        <div className="content-frame">{children}</div>
      </main>
      <MobileSidebarDrawer items={items} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {isElectron && <MobileNavigation items={items} />}
    </div>
  );
}
