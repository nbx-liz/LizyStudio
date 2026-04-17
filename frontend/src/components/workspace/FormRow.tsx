import { cloneElement, isValidElement, type ReactNode, useId } from "react";

interface FormRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

export function FormRow({ label, description, children }: FormRowProps) {
  // Issue #90: render an explicit <label htmlFor> and propagate an id
  // onto the child input so axe's `label` rule passes. Mirrors the
  // FormField pattern. When the caller already supplies an id we
  // respect it instead of overwriting.
  //
  // Caveat: same as FormField — non-element children (string, fragment,
  // array) cannot receive an id, so the <label htmlFor> would dangle.
  // All current callers pass a single element; warn in dev to catch a
  // future regression.
  const generatedId = useId();
  let resolvedId = generatedId;
  let labelledChildren: ReactNode = children;
  if (isValidElement<{ id?: string }>(children)) {
    const existingId = children.props.id;
    if (existingId) {
      resolvedId = existingId;
    } else {
      labelledChildren = cloneElement(children, { id: generatedId });
    }
  } else if (process.env.NODE_ENV !== "production") {
    console.warn(
      `FormRow "${label}" received non-element children; <label htmlFor> will not connect to any input.`,
    );
  }

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
      <label
        htmlFor={resolvedId}
        style={{
          minWidth: "var(--form-label-width, 90px)",
          maxWidth: "var(--form-label-width, 90px)",
          fontSize: "var(--control-font-size, 12px)",
          color: "var(--lzs-label-color)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={description ?? label}
      >
        {label}
      </label>
      {labelledChildren}
    </div>
  );
}
