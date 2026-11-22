// The checks an agent's item change runs before anything is written or stored, one sequence per change kind, for a
// direct change (`edit`) and a proposal (`propose`) alike. Each throws the agent's refusal.
import type { LoadedItem, ValidBinder } from "./catalog.ts";
import { agentWriteError, checkBinder, linksToIds, scrubbed, type View } from "./agent-view.ts";
import { checkHasId, checkLevel, checkLocks, invalidFields, type Family, type ItemInput } from "./refusals.ts";
import { listed, type Writer } from "./write.ts";

export const writeGuards = (writer: Writer) => {
  /**
   * The problems of a free-named binder's new `file`; a path in a hidden binder's folder reads exactly like
   * one in a folder that doesn't exist.
   */
  const fileProblems = async (current: View, binder: ValidBinder, file: unknown) => {
    if (binder.settings.naming !== "free") return [];
    try {
      return scrubbed(current, await writer.checkNewFile(binder.id, file, current.hiddenFolders), "the new item", binder);
    } catch (error) {
      throw agentWriteError(current, error, { binder });
    }
  };

  const checkNewFile = async (current: View, binder: ValidBinder, file: unknown, family: Family) => {
    const badFile = await fileProblems(current, binder, file);
    if (badFile.length === 0) return;
    const next = family === "edit" ? "Nothing was written; give another path and try again." : "Nothing was stored; give another path and propose again.";
    throw invalidFields(`The new item's file doesn't fit ${binder.id}: ${listed(badFile)}. ${next}`, badFile);
  };

  return {
    /** Answers the new item's properties with links as ids. */
    create: async (current: View, binder: ValidBinder, input: ItemInput, family: Family) => {
      checkLevel(binder, family, "create");
      const properties = input.properties ?? {};
      checkLocks(binder, "create", Object.keys(properties));
      const linked = linksToIds(current, binder, properties);
      checkBinder(current, binder);
      await checkNewFile(current, binder, input.file, family);
      return linked;
    },

    /** Answers the fields with links as ids. */
    update: (current: View, binder: ValidBinder, fields: Record<string, unknown>, family: Family) => {
      checkLevel(binder, family, "update");
      checkLocks(binder, "update", Object.keys(fields));
      checkBinder(current, binder);
      return linksToIds(current, binder, fields);
    },

    remove: (current: View, binder: ValidBinder, item: LoadedItem, handle: string, family: Family) => {
      checkLevel(binder, family, "delete");
      checkBinder(current, binder);
      checkHasId(item, handle);
    },
  };
};

export type WriteGuards = ReturnType<typeof writeGuards>;
