import React from "react";

interface ResponsiveTableProps {
  headers: React.ReactNode[];
  children: React.ReactNode;
  className?: string;
}

export function ResponsiveTable({ headers, children, className = "" }: ResponsiveTableProps) {
  return (
    <div className={`ui-responsive-table-wrapper ${className}`}>
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header, idx) => (
              <th key={idx}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
        </tbody>
      </table>
    </div>
  );
}
