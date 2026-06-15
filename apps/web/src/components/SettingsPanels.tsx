import type { ReactNode } from "react";

export function SettingsList({
  sections,
  active,
  onSelect,
}: {
  sections: readonly { id: string; label: string; icon: ReactNode }[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="settings-list">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          className={section.id === active ? "active" : ""}
          onClick={() => onSelect(section.id)}
        >
          {section.icon}
          <span>{section.label}</span>
        </button>
      ))}
    </aside>
  );
}

export function SettingsRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="settings-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <div className="settings-control">{control}</div>
    </div>
  );
}
