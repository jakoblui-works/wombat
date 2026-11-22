// My item writes: create, update and delete through the one Writer, with its validation and version check but no
// access levels or locks; and a new binder, through the same Writer. Items alerts come from the Writer the server is given, never from here.
import { ItemsErrorCode } from "@wombat/shared/api";
import { ROUTES, type ResponseOf } from "@wombat/shared/routes";
import type { Context, Hono } from "hono";

import { handlesById, summarize, withLinks } from "../items/api-view.ts";
import { findByRef, type Catalog, type LoadedItem } from "../items/catalog.ts";
import { ItemWriteError, ME, unfixedItem, type Writer } from "../items/write.ts";
import { errorResponse, ITEMS_STATUS, itemWriteResponse } from "./errors.ts";
import { checked, readBody, readQuery } from "./request.ts";

export type ItemWrites = { catalog: Catalog; writer: Writer };

export const noItem = (c: Context, ref: string) =>
  errorResponse(c, ITEMS_STATUS.item_not_found, ItemsErrorCode.enum.item_not_found, `There's no item ${ref}. List a binder's items to see their handles.`);

/** The handle the Writer takes for `ref` (id, handle or alias), or the refusal to answer. */
const handleOf = async (c: Context, catalog: Catalog, ref: string, action: "updated" | "deleted"): Promise<{ handle: string } | { refused: Response }> => {
  const found = findByRef((await catalog.snapshot()).items, ref);
  if (found === undefined) return { refused: noItem(c, ref) };
  if (found.handle === null) return { refused: itemWriteResponse(c, unfixedItem(ref, found.path, found.problems, action)) };
  return { handle: found.handle };
};

/** The written item as GET /items/:ref answers it, from a read after the write. */
const answered = async (catalog: Catalog, written: LoadedItem) => {
  const { binders, items } = await catalog.snapshot();
  const item = (written.id === null ? undefined : findByRef(items, written.id)) ?? written;
  return withLinks(item, binders, handlesById(items));
};

/** Runs a Writer call, answering its refusal; anything else goes on to the server's error handler. */
const writing = async (c: Context, write: () => Promise<Response>) => {
  try {
    return await write();
  } catch (error) {
    if (error instanceof ItemWriteError) return itemWriteResponse(c, error);
    throw error;
  }
};

/** `notConfigured` answers each route when the service runs without items. */
export const itemRoutes = (app: Hono, items: ItemWrites | undefined, notConfigured: (c: Context) => Response) => {
  app.post("/binders", async (c) => {
    if (!items) return notConfigured(c);
    const { catalog, writer } = items;
    const binder = await readBody(c, ROUTES.createBinder.body);
    return writing(c, async () => {
      const path = await writer.createBinder(ME, binder);
      const { binders, items: all } = await catalog.snapshot();
      const created = binders.find((candidate) => candidate.path === path);
      if (created === undefined) throw new Error(`The new binder at ${path} was written but isn't listed in the read after it.`);
      return c.json(checked(ROUTES.createBinder.response, summarize(created, all)) satisfies ResponseOf<typeof ROUTES.createBinder>, 201);
    });
  });

  app.post("/binders/:id/items", async (c) => {
    if (!items) return notConfigured(c);
    const { catalog, writer } = items;
    const item = await readBody(c, ROUTES.createItem.body);
    return writing(c, async () => {
      const created = await writer.createItem(ME, c.req.param("id"), item);
      return c.json(checked(ROUTES.createItem.response, await answered(catalog, created)) satisfies ResponseOf<typeof ROUTES.createItem>, 201);
    });
  });

  app.patch("/items/:ref", async (c) => {
    if (!items) return notConfigured(c);
    const { catalog, writer } = items;
    const { version, fields } = await readBody(c, ROUTES.updateItem.body);
    const target = await handleOf(c, catalog, c.req.param("ref"), "updated");
    if ("refused" in target) return target.refused;
    const { handle } = target;
    return writing(c, async () => {
      const updated = await writer.updateItem(ME, handle, fields, version);
      return c.json(checked(ROUTES.updateItem.response, await answered(catalog, updated)) satisfies ResponseOf<typeof ROUTES.updateItem>);
    });
  });

  app.delete("/items/:ref", async (c) => {
    if (!items) return notConfigured(c);
    const { catalog, writer } = items;
    const { version } = readQuery(c, ROUTES.deleteItem.query);
    const target = await handleOf(c, catalog, c.req.param("ref"), "deleted");
    if ("refused" in target) return target.refused;
    const { handle } = target;
    return writing(c, async () => {
      await writer.deleteItem(ME, handle, version);
      return c.body(null, 204);
    });
  });
};
