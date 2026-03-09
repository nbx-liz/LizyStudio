/**
 * Minimal JSON-to-YAML serializer for read-only config display.
 * No external dependencies required.
 */

function indent(level: number): string {
  return "  ".repeat(level);
}

function formatValue(value: unknown, level: number): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // Quote strings that could be misinterpreted
    if (
      value === "" ||
      value === "true" ||
      value === "false" ||
      value === "null" ||
      value.includes(":") ||
      value.includes("#") ||
      value.includes("\n") ||
      /^[\d.]+$/.test(value)
    ) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const lines = value.map(
      (item) => `${indent(level)}- ${formatValue(item, level + 1)}`,
    );
    return "\n" + lines.join("\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}";
    const lines = keys.map((key) => {
      const val = obj[key];
      const formatted = formatValue(val, level + 1);
      if (formatted.startsWith("\n")) {
        return `${indent(level)}${key}:${formatted}`;
      }
      return `${indent(level)}${key}: ${formatted}`;
    });
    return "\n" + lines.join("\n");
  }
  return String(value);
}

/**
 * Convert a plain object to a YAML-like string for display purposes.
 */
export function toYaml(obj: unknown): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return String(obj);

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) return "{}";

  return keys
    .map((key) => {
      const val = record[key];
      const formatted = formatValue(val, 1);
      if (formatted.startsWith("\n")) {
        return `${key}:${formatted}`;
      }
      return `${key}: ${formatted}`;
    })
    .join("\n");
}
