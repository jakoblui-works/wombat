/**
 * Runs a module's `register` once per page. Registries live as long as the page and refuse an id twice, so a second
 * copy of the module (a hot update in development) reloads the page instead; `hot` is the module's `import.meta.hot`,
 * whose `data` outlives each copy.
 */
export const registerOnce = (hot: { data: { registered?: boolean } } | undefined, register: () => void): void => {
  if (hot?.data.registered === true) {
    location.reload();
    return;
  }
  register();
  if (hot) hot.data.registered = true;
};
