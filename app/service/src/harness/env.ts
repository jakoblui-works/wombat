/** Variables an agent gets from the service's environment, by exact name; any `XDG_*` name is allowed too. */
export const ENV_ALLOWLIST: readonly string[] = ["HOME", "PATH", "USER", "LANG", "TERM", "SHELL"];

const allowlisted = (name: string) => ENV_ALLOWLIST.includes(name) || name.startsWith("XDG_");

// The service's own settings and token, and an API key that would bypass the user's Claude login.
const forbidden = (name: string) => name.startsWith("WOMBAT_") || name === "ANTHROPIC_API_KEY";

/**
 * The environment for an agent process: the allowlisted variables `source` has, then what the harness
 * `declared`, overriding. Forbidden names are dropped even when declared.
 */
export const agentEnv = (source: NodeJS.ProcessEnv, declared: Record<string, string> = {}): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && allowlisted(name)) env[name] = value;
  }
  for (const [name, value] of Object.entries(declared)) env[name] = value;
  for (const name of Object.keys(env)) {
    if (forbidden(name)) delete env[name];
  }
  return env;
};
