import { defineConfig } from "vitest/config";

// One run for every package, so they share one pool of workers: three runs side by side start three pools, and the
// tests that start real processes then time out waiting for a core. Half the cores: a run that fills every core
// also times out once the machine slows down (a laptop throttling under the load).
export default defineConfig({
  test: {
    maxWorkers: "50%",
    projects: ["shared", "service", "desktop"].map((name) => ({ test: { name, root: `./${name}` } })),
  },
});
