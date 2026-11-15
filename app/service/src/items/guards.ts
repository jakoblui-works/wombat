// The checks an agent's item change runs before anything is written or stored, one sequence per change kind, for a
// direct change (`edit`) and a proposal (`propose`) alike. Each throws the agent's refusal.
import type { LoadedItem, ValidStructure } from "./catalog.ts";
import { agentWriteError, checkStructure, linksToIds, scrubbed, type View } from "./agent-view.ts";
import { checkHasId, checkLevel, checkLocks, invalidFields, type Family, type ItemInput } from "./refusals.ts";
import { listed, type Writer } from "./write.ts";

export const writeGuards = (writer: Writer) => {
  /**
   * The problems of a free-named structure's new `file`; a path in a hidden structure's folder reads exactly like
   * one in a folder that doesn't exist.
   */
  const fileProblems = async (current: View, structure: ValidStructure, file: unknown) => {
    if (structure.settings.naming !== "free") return [];
    try {
      return scrubbed(current, await writer.checkNewFile(structure.id, file, current.hiddenFolders), "the new item", structure);
    } catch (error) {
      throw agentWriteError(current, error, { structure });
    }
  };

  const checkNewFile = async (current: View, structure: ValidStructure, file: unknown, family: Family) => {
    const badFile = await fileProblems(current, structure, file);
    if (badFile.length === 0) return;
    const next = family === "edit" ? "Nothing was written; give another path and try again." : "Nothing was stored; give another path and propose again.";
    throw invalidFields(`The new item's file doesn't fit ${structure.id}: ${listed(badFile)}. ${next}`, badFile);
  };

  return {
    /** Answers the new item's properties with links as ids. */
    create: async (current: View, structure: ValidStructure, input: ItemInput, family: Family) => {
      checkLevel(structure, family, "create");
      const properties = input.properties ?? {};
      checkLocks(structure, "create", Object.keys(properties));
      const linked = linksToIds(current, structure, properties);
      checkStructure(current, structure);
      await checkNewFile(current, structure, input.file, family);
      return linked;
    },

    /** Answers the fields with links as ids. */
    update: (current: View, structure: ValidStructure, fields: Record<string, unknown>, family: Family) => {
      checkLevel(structure, family, "update");
      checkLocks(structure, "update", Object.keys(fields));
      checkStructure(current, structure);
      return linksToIds(current, structure, fields);
    },

    remove: (current: View, structure: ValidStructure, item: LoadedItem, handle: string, family: Family) => {
      checkLevel(structure, family, "delete");
      checkStructure(current, structure);
      checkHasId(item, handle);
    },
  };
};

export type WriteGuards = ReturnType<typeof writeGuards>;
