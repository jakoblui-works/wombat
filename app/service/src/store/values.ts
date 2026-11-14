export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export const asNumber = (value: unknown) => {
  if (typeof value !== "number") throw new Error(`Expected a number in the database, got ${typeof value}.`);
  return value;
};

export const asString = (value: unknown) => {
  if (typeof value !== "string") throw new Error(`Expected text in the database, got ${typeof value}.`);
  return value;
};

export const asNullableString = (value: unknown) => (value === null ? null : asString(value));
