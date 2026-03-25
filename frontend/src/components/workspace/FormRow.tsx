import type { ReactNode } from "react";

interface FormRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

export function FormRow({ label, description, children }: FormRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "var(--form-row-gap, 6px)",
        fontSize: "var(--form-font-size, 13px)",
      }}
    >
      <span
        style={{
          minWidth: "var(--form-label-width, 90px)",
          maxWidth: "var(--form-label-width, 90px)",
          fontSize: "var(--control-font-size, 12px)",
          color: "var(--lzs-label-color, #4a5568)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={description ?? label}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
