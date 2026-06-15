import React from "react";

interface ResponsiveTableProps {
  headers: React.ReactNode[];
  children: React.ReactNode;
  className?: string;
}

export function ResponsiveTable({ headers, children, className = "" }: ResponsiveTableProps) {
  return (
    <div className={`responsive-table ${className}`}>
      <table>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {React.Children.map(children, (child) => {
            if (!React.isValidElement(child)) return child;

            return React.cloneElement(child as React.ReactElement<any>, {
              className: `responsive-table-row ${(child.props as any).className || ""}`,
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
