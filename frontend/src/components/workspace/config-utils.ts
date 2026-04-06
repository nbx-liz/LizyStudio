/**
 * Shared utility functions for nested object manipulation and schema
 * resolution in config forms.
 */

// --- Schema types ---

export interface SchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  anyOf?: SchemaProperty[];
  oneOf?: SchemaProperty[];
  discriminator?: { propertyName?: string };
  additionalProperties?: boolean | SchemaProperty;
  nullable?: boolean;
  /** Resolved alternatives for multi-type anyOf (discriminated unions). */
  alternatives?: SchemaProperty[];
}

export type Defs = Record<string, SchemaProperty>;

// --- Nested value helpers ---

export function getNestedValue(
  obj: Record<string, unknown>,
  path: string[],
): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  const result = { ...obj };
  if (path.length === 1) {
    result[path[0]] = value;
    return result;
  }
  const [first, ...rest] = path;
  result[first] = setNestedValue(
    (result[first] as Record<string, unknown>) ?? {},
    rest,
    value,
  );
  return result;
}

// --- Schema helpers ---

/**
 * Returns true when `anyOf` represents a simple Optional<T> pattern:
 * exactly one non-null type alongside a null type.
 * Returns false for discriminated unions (multiple non-null types).
 */
export function isNullableUnion(anyOf: SchemaProperty[]): boolean {
  const hasNull = anyOf.some((v) => v.type === "null");
  const nonNullCount = anyOf.filter((v) => v.type !== "null").length;
  return hasNull && nonNullCount === 1;
}

// --- Schema resolution ---

export function resolveSchema(
  prop: SchemaProperty,
  defs: Defs,
  currentValue?: unknown,
  _visited: Set<string> = new Set(),
): SchemaProperty {
  if (prop.$ref) {
    if (_visited.has(prop.$ref)) return prop; // cycle guard
    const nextVisited = new Set(_visited).add(prop.$ref);
    const refName = prop.$ref.replace("#/$defs/", "");
    const resolved = defs[refName];
    if (resolved) {
      return {
        ...resolveSchema(resolved, defs, currentValue, nextVisited),
        ...(prop.title ? { title: prop.title } : {}),
        ...(prop.default !== undefined ? { default: prop.default } : {}),
        ...(prop.description ? { description: prop.description } : {}),
      };
    }
  }

  if (prop.anyOf) {
    const hasNull = prop.anyOf.some((v) => v.type === "null");
    const nonNull = prop.anyOf.filter(
      (v) =>
        v.type !== "null" &&
        (v.type !== undefined || v.$ref || v.oneOf || v.anyOf),
    );
    const effectiveValue = currentValue ?? prop.default;

    if (nonNull.length === 1) {
      const resolved = resolveSchema(
        nonNull[0],
        defs,
        effectiveValue,
        _visited,
      );
      return {
        ...resolved,
        ...(prop.title ? { title: prop.title } : {}),
        ...(prop.default !== undefined ? { default: prop.default } : {}),
        ...(prop.description ? { description: prop.description } : {}),
        ...(hasNull ? { nullable: true } : {}),
      };
    }

    // Multi-type anyOf: discriminated union — expose all alternatives and pick
    // the best match based on the current value's shape.
    if (nonNull.length > 1) {
      const resolvedAlternatives = nonNull.map((v) =>
        resolveSchema(v, defs, effectiveValue, _visited),
      );

      // Pick the matching alternative: prefer an alternative whose const-keyed
      // property value matches what's in the current value object.
      const currentObj =
        effectiveValue != null && typeof effectiveValue === "object"
          ? (effectiveValue as Record<string, unknown>)
          : null;

      let primary = resolvedAlternatives[0];
      if (currentObj) {
        const match = resolvedAlternatives.find((alt) => {
          if (!alt.properties) return false;
          return Object.entries(alt.properties).some(([k, p]) => {
            const resolved = resolveSchema(p, defs, undefined, _visited);
            return (
              resolved.const !== undefined &&
              String(resolved.const) === String(currentObj[k])
            );
          });
        });
        if (match) primary = match;
      }

      return {
        ...primary,
        ...(prop.title ? { title: prop.title } : {}),
        ...(prop.default !== undefined ? { default: prop.default } : {}),
        ...(prop.description ? { description: prop.description } : {}),
        ...(hasNull ? { nullable: true } : {}),
        alternatives: resolvedAlternatives,
      };
    }

    const withOneOf = nonNull.find((v) => v.oneOf || v.$ref);
    if (withOneOf) {
      return resolveSchema(
        {
          ...withOneOf,
          ...(prop.title ? { title: prop.title } : {}),
          ...(prop.default !== undefined ? { default: prop.default } : {}),
          ...(hasNull ? { nullable: true } : {}),
        },
        defs,
        effectiveValue,
        _visited,
      );
    }
    if (nonNull.length > 0) {
      return {
        ...resolveSchema(nonNull[0], defs, effectiveValue, _visited),
        ...(hasNull ? { nullable: true } : {}),
      };
    }
  }

  if (prop.oneOf && prop.discriminator?.propertyName) {
    const discKey = prop.discriminator.propertyName;
    const effectiveValue = currentValue ?? prop.default;
    const currentObj =
      effectiveValue != null && typeof effectiveValue === "object"
        ? (effectiveValue as Record<string, unknown>)
        : null;
    const discValue = currentObj?.[discKey];

    for (const variant of prop.oneOf) {
      const resolved = resolveSchema(variant, defs, currentValue, _visited);
      const constVal = resolved.properties?.[discKey]?.const;
      if (constVal !== undefined && String(constVal) === String(discValue)) {
        return { ...resolved, ...(prop.title ? { title: prop.title } : {}) };
      }
    }
    if (prop.oneOf.length > 0) {
      const resolved = resolveSchema(
        prop.oneOf[0],
        defs,
        currentValue,
        _visited,
      );
      return { ...resolved, ...(prop.title ? { title: prop.title } : {}) };
    }
  }

  if (prop.oneOf && !prop.discriminator && prop.oneOf.length > 0) {
    const resolved = resolveSchema(prop.oneOf[0], defs, currentValue, _visited);
    return {
      ...resolved,
      ...(prop.title ? { title: prop.title } : {}),
      ...(prop.default !== undefined ? { default: prop.default } : {}),
    };
  }

  return prop;
}

export function resolveProperties(
  props: Record<string, SchemaProperty>,
  defs: Defs,
  values: Record<string, unknown>,
): Record<string, SchemaProperty> {
  const result: Record<string, SchemaProperty> = {};
  for (const [name, prop] of Object.entries(props)) {
    result[name] = resolveSchema(prop, defs, values[name]);
  }
  return result;
}
