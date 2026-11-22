// The items as the HTTP API shapes them for the app: link values with handles, binders as listings.
import type { LoadedItem, LoadedBinder } from "./catalog.ts";
import { setOwn } from "./validate.ts";

/** Each item's current handle by id, for the link values. */
export const handlesById = (items: LoadedItem[]) =>
  new Map(items.flatMap((item) => (item.id === null ? [] : [[item.id, item.handle] as const])));

/** An item as the API sends it: link values become `{ id, handle }`; the catalog holds the target's raw id. */
export const withLinks = (item: LoadedItem, binders: LoadedBinder[], handles: Map<string, string | null>) => {
  const settings = binders.find((binder) => binder.id === item.binder)?.settings;
  if (!settings) return item;
  const properties = { ...item.properties };
  for (const [name, property] of Object.entries(settings.properties)) {
    const value = properties[name];
    if (property.type === "link" && typeof value === "string") {
      setOwn(properties, name, { id: value, handle: handles.get(value) ?? null });
    }
  }
  return { ...item, properties };
};

export const summarize = (binder: LoadedBinder, items: LoadedItem[]) => {
  const own = items.filter((item) => item.binder === binder.id);
  const listing = {
    path: binder.path,
    itemCount: binder.id === null ? 0 : own.length,
    invalidCount: binder.id === null ? 0 : own.filter((item) => item.problems.length > 0).length,
    problems: binder.problems,
  };
  if (binder.id === null) return { id: null, ...listing };
  const { id, settings } = binder;
  const { name, prefix, access, naming, instructions, properties, views } = settings;
  return { id, name, prefix, access, naming, instructions, properties, views, ...listing };
};
