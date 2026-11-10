// The MCP tool names, the one place they are written: the server registers them, Access's refusals and the
// instructions file tell agents to call them.
export const TOOL = {
  describeStructure: "describe_structure",
  listItems: "list_items",
  getItem: "get_item",
  search: "search",
  createItem: "create_item",
  updateItem: "update_item",
  deleteItem: "delete_item",
  proposeCreate: "propose_create",
  proposeUpdate: "propose_update",
  proposeDelete: "propose_delete",
} as const;
