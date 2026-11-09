// Lasting check (silent failure): chat history is readable by its owner only. The database folder is
// 0700; the database and SQLite's -wal and -shm side files are 0600, whatever the umask, and looser
// modes found on open are tightened.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { open, summary, tempStorePath, textChunk } from "../../test/store-fixtures.ts";

const modeOf = (path: string) => statSync(path).mode & 0o777;

const permissiveUmask = () => {
  const previous = process.umask(0o000);
  onTestFinished(() => {
    process.umask(previous);
  });
};

const expectPrivate = (path: string) => {
  expect(modeOf(dirname(path)).toString(8)).toBe("700");
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    expect(existsSync(file), `${file} exists`).toBe(true);
    expect(modeOf(file).toString(8), file).toBe("600");
  }
};

/** Writes something, so SQLite has its -wal and -shm files open. */
const write = (store: ReturnType<typeof open>) => {
  store.putAgent(summary("a1"));
  store.append("a1", [textChunk("Hello")]);
};

describe("the database is private to its owner", () => {
  test("a new database: folder 0700, database, -wal and -shm 0600, even with umask 000", () => {
    permissiveUmask();
    const path = tempStorePath();
    const store = open({ path });
    write(store);
    expectPrivate(path);
  });

  test("looser modes on an existing folder and database are tightened on open", () => {
    permissiveUmask();
    const path = tempStorePath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
    const first = open({ path });
    write(first);
    first.close();
    chmodSync(dirname(path), 0o777);
    chmodSync(path, 0o644);

    const reopened = open({ path });
    reopened.append("a1", [textChunk("Again")]);
    expectPrivate(path);
  });

  test("-wal and -shm left looser by a session that never closed are tightened on open", async () => {
    permissiveUmask();
    const path = tempStorePath();
    await crashMidSession(path);
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      expect(existsSync(file), `${file} left behind by the killed session`).toBe(true);
      chmodSync(file, 0o644);
    }

    const reopened = open({ path });
    // The files are real: what the killed session wrote is recovered.
    expect(reopened.readLog("a1").entries).toHaveLength(1);
    expectPrivate(path);
  });
});

/**
 * A real store session in another process that writes and is then killed with SIGKILL, so SQLite never
 * checkpoints or removes its -wal and -shm files (as after a crash).
 */
const crashMidSession = async (path: string) => {
  const script = `
    const [storeModule, path, agent, entry] = process.argv.slice(1);
    const { openStore } = await import(storeModule);
    const store = openStore({ path });
    store.putAgent(JSON.parse(agent));
    store.append("a1", [JSON.parse(entry)]);
    process.stdout.write("ready\\n");
    setInterval(() => undefined, 1000);
  `;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      script,
      join(import.meta.dirname, "store.ts"),
      path,
      JSON.stringify(summary("a1")),
      JSON.stringify(textChunk("Written before the crash.")),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  onTestFinished(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (chunk.includes("ready")) resolve();
    });
    void exited.then(() => reject(new Error(`the session exited before writing:\n${stderr}`)));
  });
  child.kill("SIGKILL");
  await exited;
};
