import React from "react";

interface ResponsiveTableProps {
  headers: React.ReactNode[];
  children: React.ReactNode;
}

export function ResponsiveTable({ headers, children }: ResponsiveTableProps) {
  return (
    <div className="ui-responsive-table-wrapper" style={{ margin: 0, padding: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "600px" }}>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th
                key={index}
                style={{
                  padding: "12px var(--card-padding-desktop)",
                  textAlign: "left",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  borderBottom: "1px solid var(--border-color)",
                  whiteSpace: "nowrap"
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {React.Children.map(children, (child) => {
            if (!React.isValidElement(child)) return child;
            
            // Inyectamos padding y border-bottom en todos los td
            return React.cloneElement(child as React.ReactElement<any>, {
              style: {
                ...((child.props as any).style || {}),
                borderBottom: "1px solid var(--border-color)",
                transition: "background var(--t-fast)"
              },
              className: `ui-table-row ${(child.props as any).className || ""}`
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

// Inyectamos un pequeño script para los td
const tableStyles = `
  .ui-table-row:hover { background: var(--bg-surface-hover); }
  .ui-table-row td { padding: 12px var(--card-padding-desktop); font-size: 14px; vertical-align: middle; }
  .ui-table-row:last-child td { border-bottom: none; }
`;

if (typeof document !== "undefined") {
  const styleEl = document.createElement("style");
  styleEl.innerHTML = tableStyles;
  document.head.appendChild(styleEl);
}
