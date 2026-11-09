// Fake `systemd-run` and `systemctl` for tests: shell scripts in a temp bin dir that record
// every call, so tests see which scopes and slices the service asks for without a real user manager.
// `systemd-run` skips its options up to `--` and execs the rest in place, as the real one does with --scope.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** What `systemctl --user is-system-running` does: print a state (exit 0 for running, 1 otherwise), or fail to reach the bus. */
export type ManagerState = "running" | "degraded" | "offline" | "no-bus";

export type FakeSystemdOptions = {
  /** Default "running". */
  state?: ManagerState;
  /** Whether `systemctl --user is-active <slice>` reports `active` (something left from a previous service). */
  sliceActive?: boolean;
  /** `systemd-run` fails without running the command, as when the scope can't be created. */
  runFails?: boolean;
  /** `systemctl kill`/`stop` print this on stdout and stderr and exit 1; `is-active` prints it on stderr. */
  noise?: string;
};

export type Call = { tool: "systemd-run" | "systemctl"; args: string[] };

export type FakeSystemd = {
  /** The dir holding both fakes, for the front of PATH. */
  binDir: string;
  /** Every call so far, in the order they were recorded. */
  calls: () => Call[];
  remove: () => void;
};

// Record and field separators: ASCII RS and US, which no argument here contains.
const RS = "\x1e";
const US = "\x1f";

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Appends one record per call in a single write, so concurrent calls don't interleave. */
const recorder = (tool: Call["tool"], log: string) => `
rec=${shellQuote(tool)}
for a in "$@"; do rec="$rec$(printf '\\037')$a"; done
printf '%s\\036' "$rec" >> ${shellQuote(log)}
`;

export const fakeSystemd = (options: FakeSystemdOptions = {}): FakeSystemd => {
  const { state = "running", sliceActive = false, runFails = false, noise } = options;
  const base = mkdtempSync(join(tmpdir(), "wombat-fake-systemd-"));
  const binDir = join(base, "bin");
  mkdirSync(binDir);
  const log = join(base, "calls");
  writeFileSync(log, "");

  // Each ends in "; ", so it can prefix a command.
  const noisyErr = noise === undefined ? "" : `echo ${shellQuote(noise)} >&2; `;
  const noisy = noise === undefined ? "" : `echo ${shellQuote(noise)}; ${noisyErr}`;

  const systemdRun = `#!/bin/sh
${recorder("systemd-run", log)}
${runFails ? `echo 'Failed to start transient scope unit: Unit already exists.' >&2\nexit 1` : ""}
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
[ "$#" -gt 0 ] && shift
exec "$@"
`;

  const isSystemRunning =
    state === "no-bus"
      ? `echo 'Failed to connect to bus: No medium found' >&2; exit 1`
      : `echo ${state}; ${state === "running" ? "exit 0" : "exit 1"}`;

  const systemctl = `#!/bin/sh
${recorder("systemctl", log)}
for a in "$@"; do
  case "$a" in
    is-system-running) ${isSystemRunning} ;;
    is-active) ${noisyErr}${sliceActive ? "echo active; exit 0" : "echo inactive; exit 3"} ;;
    kill|stop) ${noise === undefined ? "exit 0" : `${noisy}exit 1`} ;;
  esac
done
exit 0
`;

  for (const [name, script] of [
    ["systemd-run", systemdRun],
    ["systemctl", systemctl],
  ] as const) {
    const path = join(binDir, name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }

  return {
    binDir,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split(RS)
            .filter((record) => record.length > 0)
            .map((record) => {
              const [tool, ...args] = record.split(US);
              return { tool: tool as Call["tool"], args };
            })
        : [],
    remove: () => rmSync(base, { recursive: true, force: true }),
  };
};

/** The `systemctl --user kill --signal=SIGKILL <unit>` calls, as the units they killed. */
export const killedUnits = (calls: Call[]) =>
  calls
    .filter(
      ({ tool, args }) =>
        tool === "systemctl" && args.includes("--user") && args.includes("kill") && args.includes("--signal=SIGKILL"),
    )
    .flatMap(({ args }) => args.filter((arg) => arg.endsWith(".scope")));

/** The `systemctl --user stop <slice>` calls for `slice`. */
export const sliceStops = (calls: Call[], slice: string) =>
  calls.filter(
    ({ tool, args }) => tool === "systemctl" && args.includes("--user") && args.includes("stop") && args.includes(slice),
  );

/** The `systemd-run` calls, as their options before `--` and the command line after it. */
export const runs = (calls: Call[]) =>
  calls
    .filter(({ tool }) => tool === "systemd-run")
    .map(({ args }) => {
      const split = args.indexOf("--");
      return split === -1 ? { options: args, command: [] } : { options: args.slice(0, split), command: args.slice(split + 1) };
    });

/** The value of a `--name=value` option, if given. */
export const option = (options: string[], name: string) =>
  options.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
