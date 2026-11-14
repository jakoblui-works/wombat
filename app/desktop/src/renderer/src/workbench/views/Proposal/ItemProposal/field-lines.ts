/** One changed field as a plain line: its name and its value as text. */
export type FieldLine = { name: string; value: string };

/** A proposed value as plain text: a list joined, nothing for an empty value, anything else as JSON. */
const valueText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(valueText).join(", ");
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

/** An item proposal's changed fields, in the order the service sent them. */
export const fieldLines = (fields: Readonly<Record<string, unknown>>): FieldLine[] =>
  Object.entries(fields).map(([name, value]) => ({ name, value: valueText(value) }));
