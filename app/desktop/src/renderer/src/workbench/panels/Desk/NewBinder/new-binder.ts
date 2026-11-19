// The New binder dialog's form, pure: the suggestions that follow the name until edited, and the request it sends.
import type { NewBinderRequest } from "@wombat/shared/api";
import { HANDLE_PREFIX_MAX, slugOf } from "@wombat/shared/items";

export type NewBinderForm = { name: string; prefix: string; folder: string; prefixEdited: boolean; folderEdited: boolean };

export type NewBinderField = "name" | "prefix" | "folder";

export const EMPTY_FORM: NewBinderForm = { name: "", prefix: "", folder: "", prefixEdited: false, folderEdited: false };

const ONE_WORD_PREFIX = 4;

/** A handle prefix from the name: the words' initials, or a single word's first letters; uppercase, starting with a letter. */
export const prefixSuggestion = (name: string): string => {
  const words = (name.normalize("NFKD").toUpperCase().match(/[A-Z0-9]+/g) ?? []).map((word, index) => (index === 0 ? word.replace(/^[0-9]+/, "") : word)).filter(Boolean);
  const prefix = words.length === 1 ? (words[0] ?? "").slice(0, ONE_WORD_PREFIX) : words.map((word) => word[0]).join("");
  return prefix.slice(0, HANDLE_PREFIX_MAX);
};

/** The form after one field changes; a prefix or folder not edited by hand follows the name. */
export const editForm = (form: NewBinderForm, field: NewBinderField, value: string): NewBinderForm => {
  if (field === "prefix") return { ...form, prefix: value, prefixEdited: true };
  if (field === "folder") return { ...form, folder: value, folderEdited: true };
  return {
    ...form,
    name: value,
    prefix: form.prefixEdited ? form.prefix : prefixSuggestion(value),
    folder: form.folderEdited ? form.folder : slugOf(value),
  };
};

/** The request for a binder in `drawer` (root-relative, "" for the items folder); Folder is relative to it. */
export const newBinderRequest = (drawer: string, form: NewBinderForm): NewBinderRequest => {
  const folder = form.folder.trim();
  return { name: form.name.trim(), prefix: form.prefix.trim(), path: drawer === "" ? folder : `${drawer}/${folder}` };
};
