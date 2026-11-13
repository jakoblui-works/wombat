// The app's trust boundary, checked against the built app (`out/main/index.js`, rebuilt by
// `global-setup.ts` before every run). Each test launches its own app in its own sandbox
// (app-fixtures.ts: display-less, `WOMBAT_E2E=1`, temp dirs, fake systemd and fake agents).
import type { ElectronApplication, Page, Response } from "@playwright/test";
import { bridgeCommand, bridgeRequest, expect, isAlive, REPO, test, waitForConnection, waitUntil, WAIT_MS, watchZoom, zoomLevel, zoomsHeard, type Sandbox } from "./app-fixtures.ts";

// Everything the preload may expose to the page. Adding a global, a name or a function widens
// what a page (and anything that gets into it) can reach in the host: each is a deliberate,
// reviewed decision, made here and in the preload together.
// The globals the preload adds to the page (beyond what a blank page of the same engine has).
const ALLOWED_BRIDGE_GLOBALS = ["wombat"];
// Globals the page's own libraries set on window (not the preload: they reach nothing in the host). Each is named,
// with its library, and may only hold data, never a function. zod (the renderer's data layer) keeps its config and, once a
// schema is registered, its registry there.
const PAGE_LIBRARY_GLOBALS: Record<string, string> = {
  __zod_globalConfig: "zod",
  __zod_globalRegistry: "zod",
};
// The names on `window.wombat`.
// (The bridge's shape is `WombatBridge` in desktop/src/shared/bridge.ts.)
const ALLOWED_BRIDGE_NAMES = ["apiVersion", "service", "workspace", "settings", "onOpenAgent", "command", "onZoom"];
// The paths under `window.wombat` whose values are functions (e.g. "service.connect").
const ALLOWED_BRIDGE_FUNCTIONS: string[] = [
  "service.request",
  "service.onAlert",
  "service.onConnection",
  "service.restart",
  "workspace.get",
  "workspace.switch",
  "settings.get",
  "settings.set",
  "onOpenAgent",
  "command",
  "onZoom",
];

// An outside https URL. Requests to it are answered locally (see `stubOutside`),
// so if the app let it load it would load, with or without a network.
const OUTSIDE_URL = "https://example.com/";
const OUTSIDE_PATTERN = "https://example.com/**";
// How long a blocked action gets to take effect before we look.
const SETTLE_MS = 2_000;

// The only sources the page's CSP may use: 'self' and 'none' anywhere, the
// style nonce only where <style> elements are governed, data: only for images, 'unsafe-inline' only
// for style="" attributes (VS Code's own style policy; Monaco draws its lines with them). Anything
// else (a host, a scheme, a hash, a dev nonce, any other 'unsafe-*', 'strict-dynamic') is a relaxation.
const isNonce = (source: string): boolean => /^'nonce-[^']+'$/.test(source);
const NONCE_DIRECTIVES = ["style-src-elem", "style-src"];
const DATA_DIRECTIVES = ["img-src"];
const UNSAFE_INLINE_DIRECTIVES = ["style-src-attr"];
const allowedSource = (directive: string, source: string): boolean =>
  source === "'self'" ||
  source === "'none'" ||
  (isNonce(source) && NONCE_DIRECTIVES.includes(directive)) ||
  (source === "data:" && DATA_DIRECTIVES.includes(directive)) ||
  (source === "'unsafe-inline'" && UNSAFE_INLINE_DIRECTIVES.includes(directive));
// Directives that must be exactly 'none'.
const NONE_DIRECTIVES = ["object-src", "base-uri", "form-action", "frame-ancestors"];

// Handing an https URL to the host's browser is a legitimate way for the app to handle a link,
// so the checks don't care whether it happens; but a test must never open the real browser.
// App code must call `shell.openExternal(...)` at the moment of use, not a copy captured at load.
const recordOpenExternal = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { wombatE2eOpenedExternally?: string[] }).wombatE2eOpenedExternally = opened;
    shell.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
  });

// Every launch runs in a sandbox of its own (app-fixtures.ts): display-less, temp profile, runtime and state dirs,
// fake systemd and fake agents, so a check never reaches the real service, settings or agents.
const launch = async (sandbox: Sandbox): Promise<{ app: ElectronApplication; page: Page }> => {
  const launched = await sandbox.launch();
  await recordOpenExternal(launched.app);
  return { app: launched.app, page: launched.page };
};

// Answer outside requests locally, so the outcome never depends on the network.
const stubOutside = async (target: ElectronApplication): Promise<void> => {
  await target.context().route(OUTSIDE_PATTERN, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>outside</title><p>outside page</p>" }),
  );
};

const windowCount = (target: ElectronApplication): Promise<number> =>
  target.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

const directives = (policy: string): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().toLowerCase().split(/\s+/);
    if (name && !map.has(name)) map.set(name, sources);
  }
  return map;
};

// What's wrong with one policy; empty when it's strict.
const cspProblems = (policy: string): string[] => {
  const d = directives(policy);
  const problems: string[] = [];
  for (const [name, sources] of d) {
    for (const source of sources) {
      if (!allowedSource(name, source)) problems.push(`${name} allows ${source}`);
    }
  }
  const defaults = d.get("default-src");
  if (!defaults?.includes("'self'")) problems.push("default-src lacks 'self'");
  for (const name of NONE_DIRECTIVES) {
    if (d.get(name)?.join(" ") !== "'none'") problems.push(`${name} is not 'none'`);
  }
  // The effective sources, per the CSP fallback chain (a directive left out falls back).
  const exactly = (name: string, sources: string[], expected: string): void => {
    if (sources.join(" ") !== expected) problems.push(`${name} (effective) is not ${expected}: ${sources.join(" ")}`);
  };
  const scripts = d.get("script-src") ?? defaults ?? [];
  exactly("script-src", scripts, "'self'");
  exactly("script-src-elem", d.get("script-src-elem") ?? scripts, "'self'");
  exactly("script-src-attr", d.get("script-src-attr") ?? scripts, "'self'");
  exactly("worker-src", d.get("worker-src") ?? d.get("child-src") ?? scripts, "'self'");
  exactly("connect-src", d.get("connect-src") ?? defaults ?? [], "'none'");
  // Styles: <style>/<link> elements need 'self' or the page's nonce; style="" attributes are allowed
  // inline and nothing else, as in VS Code's own style policy (Monaco draws its lines with them).
  // CSSOM styles, i.e. React style props, are not governed by CSP.
  const styles = d.get("style-src") ?? defaults ?? [];
  const styleElems = d.get("style-src-elem") ?? styles;
  const elemOthers = styleElems.filter((source) => source !== "'self'" && !isNonce(source));
  if (!styleElems.includes("'self'") || styleElems.filter(isNonce).length !== 1 || elemOthers.length > 0) {
    problems.push(`style-src-elem (effective) is not exactly 'self' and one nonce: ${styleElems.join(" ")}`);
  }
  exactly("style-src-attr", d.get("style-src-attr") ?? styles, "'unsafe-inline'");
  return problems;
};

// The CSP policies a response carries (each header may hold several, comma-separated).
const servedPolicies = async (response: Response): Promise<string[]> =>
  (await response.headersArray())
    .filter(({ name }) => name.toLowerCase() === "content-security-policy")
    .flatMap(({ value }) => value.split(","))
    .map((policy) => policy.trim())
    .filter((policy) => policy !== "");

// Reload the app's page; return the main document's response (what the app:// handler sent).
const reloadPage = async (target: Page): Promise<Response> => {
  const response = await target.reload();
  if (!response) throw new Error("Reloading the page gave no response for its document.");
  await target.getByTestId("api-version").waitFor();
  return response;
};

const metaNonce = (target: Page): Promise<string | null> =>
  target.evaluate(() => document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? null);

// Record securitypolicyviolation events from the very start of every load from now on.
const VIOLATIONS = "__wombatE2eCspViolations";
const recordViolations = async (target: Page): Promise<void> => {
  await target.addInitScript((key) => {
    const seen: string[] = [];
    (window as unknown as Record<string, unknown>)[key] = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} blocked ${event.blockedURI || "(inline)"} at ${event.sourceFile}:${event.lineNumber}`);
    });
  }, VIOLATIONS);
};
const violations = (target: Page): Promise<string[]> =>
  target.evaluate((key) => [...((window as unknown as Record<string, string[] | undefined>)[key] ?? ["(recorder missing)"])], VIOLATIONS);

// Let the tasks queued during load (effects, injected styles) run.
const settleTasks = (target: Page): Promise<void> =>
  target.evaluate(() => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0)));

let app: ElectronApplication | undefined;
let page: Page | undefined;

const opened = (): { app: ElectronApplication; page: Page } => {
  if (!app || !page) throw new Error("The app didn't launch (see beforeEach).");
  return { app, page };
};

// The sandbox's teardown stops the app, its service and agents.
test.beforeEach(async ({ sandbox }) => {
  app = undefined;
  page = undefined;
  ({ app, page } = await launch(sandbox));
});

const windowIsLockedDown = (): Promise<void> =>
  test.step("the app's window has context isolation and the sandbox on, and Node off", async () => {
  const { app } = opened();
  expect(await windowCount(app)).toBe(1);
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // `getLastWebPreferences` exists at runtime but is missing from Electron's typings.
    type WithPrefs = { getLastWebPreferences?: () => Record<string, unknown> | null };
    const contents = BrowserWindow.getAllWindows()[0]?.webContents as unknown as WithPrefs | undefined;
    const last = contents?.getLastWebPreferences?.() ?? null;
    return last && {
      contextIsolation: last["contextIsolation"],
      sandbox: last["sandbox"],
      nodeIntegration: last["nodeIntegration"],
    };
  });
  expect(prefs, "webContents.getLastWebPreferences() returned nothing").not.toBeNull();
  expect(prefs).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false });
});

const windowOpenOpensNothing = (): Promise<void> =>
  test.step("window.open from the renderer opens no window", async () => {
  const { app, page } = opened();
  await stubOutside(app);
  const newWindow = app.waitForEvent("window", { timeout: SETTLE_MS }).then(
    (newPage) => newPage.url(),
    () => null,
  );
  await page.evaluate((url) => {
    window.open(url);
  }, OUTSIDE_URL);
  expect(await newWindow, "a new window opened").toBeNull();
  expect(await windowCount(app)).toBe(1);
});

const outsideNavigationStaysOnApp = (): Promise<void> =>
  test.step("navigating the page to an outside https URL leaves it on the app", async () => {
  const { app, page } = opened();
  await stubOutside(app);
  const appUrl = page.url();
  expect(appUrl).not.toContain("example.com");
  // The navigation may tear down the context the evaluate runs in; that's an outcome, not an error.
  await page
    .evaluate((url) => {
      location.href = url;
    }, OUTSIDE_URL)
    .catch(() => undefined);
  await page.waitForURL((url) => url.href !== appUrl, { timeout: SETTLE_MS }).catch(() => undefined);
  // Ask the main process: Playwright keeps waiting on a navigation the app cancelled.
  const after = await app.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    if (!contents) return null;
    const appContent: unknown = await contents.executeJavaScript(
      `document.querySelector('[data-testid="api-version"]') !== null`,
    );
    return { url: contents.getURL(), loading: contents.isLoading(), appContent };
  });
  expect(after).toEqual({ url: appUrl, loading: false, appContent: true });
});

// The policy comes from the app:// handler as a response header, never a
// meta tag; this reads what the handler sent, not a copy of the string.
const pageHasOneStrictCsp = (): Promise<void> =>
  test.step("the page is served with one strict CSP header, and no CSP meta tag", async () => {
  const { page } = opened();
  const response = await reloadPage(page);
  const policies = await servedPolicies(response);
  expect(policies, "the page's response has no Content-Security-Policy header").not.toHaveLength(0);
  expect(policies, "the page's response carries more than one CSP policy").toHaveLength(1);
  const report = policies.map((policy) => ({ policy, problems: cspProblems(policy) }));
  expect(report, "the served CSP isn't strict").toEqual(policies.map((policy) => ({ policy, problems: [] })));
  const metaPolicies = await page.$$eval('meta[http-equiv="Content-Security-Policy" i]', (metas) =>
    metas.map((meta) => meta.getAttribute("content") ?? ""),
  );
  expect(metaPolicies, "a CSP meta tag is left in index.html").toEqual([]);
});

// Everything else app:// serves (the page's own scripts and styles, Monaco's worker, a 404) carries a fixed policy of
// its own: a worker runs under its response's policy, not the page's, so without one it could fetch anything.
// Read through main's net.fetch, which goes through the same app:// handler the page's loads do.
const otherResponsesCarryAPolicy = (): Promise<void> =>
  test.step("every other app:// response, an asset or a 404, carries one policy: default-src 'self', connect-src and object-src 'none'", async () => {
  const { app: main, page: shown } = opened();
  const asset = await shown.evaluate(() => document.querySelector<HTMLScriptElement>("script[src]")?.src ?? null);
  expect(asset, "the page loads no script file to check").not.toBeNull();
  const missing = new URL("/assets/no-such-file.js", asset ?? "").href;
  for (const [url, status] of [
    [asset ?? "", 200],
    [missing, 404],
  ] as const) {
    const answer = await main.evaluate(async ({ net }, href) => {
      const response = await net.fetch(href);
      return { status: response.status, policies: response.headers.get("content-security-policy") };
    }, url);
    expect(answer.status, url).toBe(status);
    const policies = (answer.policies ?? "").split(",").map((policy) => policy.trim()).filter((policy) => policy !== "");
    expect(policies, `${url} carries no single CSP policy`).toHaveLength(1);
    const d = directives(policies[0] ?? "");
    expect(
      { default: d.get("default-src"), connect: d.get("connect-src"), object: d.get("object-src") },
      `${url}'s policy`,
    ).toEqual({ default: ["'self'"], connect: ["'none'"], object: ["'none'"] });
  }
});

// The style attribute probes show the relaxation Monaco needs (style="" attributes, as in VS Code's own
// style policy) is in place, and limited to attributes: <style> elements still need the nonce.
const pageEnforcesItsCsp = (): Promise<void> =>
  test.step("the page enforces its CSP: inline scripts and un-nonced <style> are blocked; nonced <style>, CSSOM styles and style attributes apply", async () => {
  const { page } = opened();
  await reloadPage(page);
  const nonce = await metaNonce(page);
  expect(nonce, "the page has no csp-nonce meta").not.toBeNull();
  const outcome = await page.evaluate((pageNonce) => {
    const flag = "__wombatInlineRan";
    const script = document.createElement("script");
    script.textContent = `window.${flag} = true;`;
    document.head.append(script);
    const inlineScript = (window as unknown as Record<string, unknown>)[flag] === true;

    const host = document.createElement("div");
    document.body.append(host);
    host.innerHTML = [
      '<span data-probe="markup-attr" style="color: rgb(1, 2, 3)"></span>',
      '<span data-probe="set-attr"></span>',
      '<span data-probe="cssom"></span>',
      '<span data-probe="style-no-nonce"></span>',
      '<span data-probe="style-nonce"></span>',
    ].join("");
    const probe = (name: string): HTMLElement => {
      const element = host.querySelector<HTMLElement>(`[data-probe="${name}"]`);
      if (!element) throw new Error(`probe ${name} missing`);
      return element;
    };
    probe("set-attr").setAttribute("style", "color: rgb(4, 5, 6)");
    probe("cssom").style.color = "rgb(7, 8, 9)";
    const plain = document.createElement("style");
    plain.textContent = '[data-probe="style-no-nonce"] { color: rgb(10, 11, 12) }';
    document.head.append(plain);
    const nonced = document.createElement("style");
    nonced.nonce = pageNonce ?? "";
    nonced.textContent = '[data-probe="style-nonce"] { color: rgb(13, 14, 15) }';
    document.head.append(nonced);
    const applied = (name: string, colour: string): boolean => getComputedStyle(probe(name)).color === colour;
    return {
      inlineScript,
      markupStyleAttribute: applied("markup-attr", "rgb(1, 2, 3)"),
      setAttributeStyle: applied("set-attr", "rgb(4, 5, 6)"),
      cssomStyle: applied("cssom", "rgb(7, 8, 9)"),
      styleWithoutNonce: applied("style-no-nonce", "rgb(10, 11, 12)"),
      styleWithNonce: applied("style-nonce", "rgb(13, 14, 15)"),
    };
  }, nonce);
  // (No eval probe: Playwright's evaluate runs outside the page's CSP, so eval would pass anyway.)
  expect(outcome).toEqual({
    inlineScript: false,
    markupStyleAttribute: true,
    setAttributeStyle: true,
    cssomStyle: true,
    styleWithoutNonce: false,
    styleWithNonce: true,
  });
});

const loadingCausesNoViolations = (): Promise<void> =>
  test.step("loading the page causes no CSP violations", async () => {
  const { page } = opened();
  await recordViolations(page);
  await reloadPage(page);
  await page.waitForLoadState("load");
  await settleTasks(page);
  expect(await violations(page), "the page broke its own CSP while loading").toEqual([]);
  // The recorder is live: a blocked inline script shows up in it.
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "void 0;";
    document.head.append(script);
  });
  await expect.poll(async () => (await violations(page)).length, { message: "the violation recorder saw nothing" }).toBeGreaterThan(0);
});

const preloadExposesOnlyTheBridge = (): Promise<void> =>
  test.step("the preload bridge exposes only the allowed globals, names and functions", async () => {
  const { page } = opened();
  const bridge = await page.evaluate(() => {
    // A blank page from the same engine shows which globals are the browser's own;
    // about:blank needs no fetch, so the strict CSP allows it.
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const blank = frame.contentWindow;
    const baseline = new Set(blank ? Object.getOwnPropertyNames(blank) : []);
    frame.remove();
    const added = Object.getOwnPropertyNames(window)
      .filter((name) => !baseline.has(name) && !/^\d+$/.test(name))
      .sort()
      .map((name) => ({ name, type: typeof (window as unknown as Record<string, unknown>)[name] }));

    const root = (window as unknown as { wombat?: unknown }).wombat;
    const functions: string[] = [];
    const walk = (value: unknown, at: string, depth: number): void => {
      if (typeof value === "function") functions.push(at);
      if (value === null || (typeof value !== "object" && typeof value !== "function") || depth > 5) return;
      for (const key of Object.keys(value)) {
        walk((value as Record<string, unknown>)[key], at ? `${at}.${key}` : key, depth + 1);
      }
    };
    walk(root, "", 0);
    return {
      added,
      names: root !== null && typeof root === "object" ? Object.keys(root).sort() : null,
      functions: functions.sort(),
    };
  });
  expect(bridge.names, "window.wombat is missing").not.toBeNull();
  const library = bridge.added.filter(({ name }) => Object.hasOwn(PAGE_LIBRARY_GLOBALS, name));
  expect(library.filter(({ type }) => type === "function"), "a page library's global is a function").toEqual([]);
  expect({ ...bridge, added: bridge.added.filter((global) => !library.includes(global)).map(({ name }) => name) }).toEqual({
    added: [...ALLOWED_BRIDGE_GLOBALS].sort(),
    names: [...ALLOWED_BRIDGE_NAMES].sort(),
    functions: [...ALLOWED_BRIDGE_FUNCTIONS].sort(),
  });
});

const permissionsAreDenied = (): Promise<void> =>
  test.step("permission requests and checks from the renderer are denied", async () => {
  const { page } = opened();
  // Probes whose outcome is decided by the app's permission handlers, not by hardware:
  // requests (Notification.requestPermission, geolocation) go through the request handler,
  // checks (Notification.permission, permissions.query) through the check handler.
  // (No getUserMedia: when allowed it opens the real microphone, and on a machine without one
  // it fails with NotFoundError, so the result would depend on the hardware.)
  const outcome = await page.evaluate(async () => {
    const notificationRequest = await Notification.requestPermission();
    // Granted, geolocation fails with POSITION_UNAVAILABLE (2) here, as there's no provider;
    // only a denial gives PERMISSION_DENIED (1).
    const geolocationError = await new Promise<number | "position">((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve("position"),
        (error) => resolve(error.code),
        { timeout: 4_000 },
      );
    });
    const queries: Record<string, string> = {};
    for (const name of ["notifications", "geolocation", "microphone", "camera"]) {
      queries[name] = await navigator.permissions
        .query({ name: name as PermissionName })
        .then((status) => status.state, (error: unknown) => `error: ${String(error)}`);
    }
    return { notificationRequest, notificationPermission: Notification.permission, geolocationError, queries };
  });
  expect(outcome).toEqual({
    notificationRequest: "denied",
    notificationPermission: "denied",
    geolocationError: 1,
    queries: { notifications: "denied", geolocation: "denied", microphone: "denied", camera: "denied" },
  });
});

// The token lives in main only. Searched everywhere the page can read: the globals the page adds, the bridge
// itself, everything the bridge answers or sends (settings, workspace, service answers, a refusal's message,
// connection states), storage, cookies and the document. The port and the discovery file's path count too: the
// page never needs them.
const pageHoldsNoToken = ({ sandbox }: { sandbox: Sandbox }): Promise<void> =>
  test.step("the page holds no token, service address or discovery path: not in its globals, the bridge, its storage or its document", async () => {
  const { page } = opened();
  await waitForConnection(page, "connected");
  const file = await sandbox.waitForService();
  // Something for the bridge to answer with: an agent with a log.
  const started = await bridgeRequest(page, "POST", "/agents", { harness: "fake-reply", repo: REPO });
  expect(started, "starting an agent through the bridge failed").toMatchObject({ ok: true, status: 201 });
  const agentId = (started as { body: { id: string } }).body.id;

  const seen = await page.evaluate(async (id) => {
    const texts: string[] = [];
    const visited = new WeakSet<object>();
    const collect = (value: unknown, depth: number): void => {
      if (typeof value === "string") texts.push(value);
      else if (typeof value === "number" || typeof value === "bigint") texts.push(String(value));
      if (value === null || (typeof value !== "object" && typeof value !== "function") || depth > 6) return;
      if (visited.has(value) || value instanceof Node || value === window) return;
      visited.add(value);
      for (const key of Object.getOwnPropertyNames(value)) {
        texts.push(key);
        let inner: unknown;
        try {
          inner = (value as Record<string, unknown>)[key];
        } catch {
          continue;
        }
        collect(inner, depth + 1);
      }
    };
    // The globals the page adds beyond a blank page of the same engine.
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const baseline = new Set(frame.contentWindow ? Object.getOwnPropertyNames(frame.contentWindow) : []);
    frame.remove();
    for (const name of Object.getOwnPropertyNames(window)) {
      if (!baseline.has(name)) collect((window as unknown as Record<string, unknown>)[name], 0);
    }
    // Everything the bridge answers or sends.
    type Bridge = {
      settings: { get: () => Promise<unknown> };
      workspace: { get: () => Promise<unknown> };
      service: {
        request: (method: string, path: string) => Promise<unknown>;
        onConnection: (cb: (state: unknown) => void) => unknown;
      };
    };
    const bridge = (window as unknown as { wombat: Bridge }).wombat;
    const calls: (() => Promise<unknown>)[] = [
      () => bridge.settings.get(),
      () => bridge.workspace.get(),
      () => bridge.service.request("GET", "/version"),
      () => bridge.service.request("GET", "/agents"),
      () => bridge.service.request("GET", "/harnesses"),
      () => bridge.service.request("GET", `/agents/${id}/log`),
      () => bridge.service.request("GET", "/no-such-route"),
      () => bridge.service.request("POST", "/shutdown"),
    ];
    for (const call of calls) {
      try {
        collect(await call(), 0);
      } catch (error) {
        texts.push(String(error), error instanceof Error ? (error.stack ?? "") : "");
      }
    }
    bridge.service.onConnection((state) => collect(state, 0));
    // Storage, cookies, the document, and what the page loaded.
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) ?? "";
        texts.push(key, storage.getItem(key) ?? "");
      }
    }
    texts.push(document.cookie, document.documentElement.outerHTML, location.href);
    texts.push(...performance.getEntries().map((entry) => entry.name));
    return texts;
  }, agentId);

  const secrets = {
    token: file.token,
    "service address (127.0.0.1)": `127.0.0.1:${String(file.port)}`,
    "service address (localhost)": `localhost:${String(file.port)}`,
    "discovery path": sandbox.discoveryPath,
  };
  for (const [what, secret] of Object.entries(secrets)) {
    expect(seen.filter((text) => text.includes(secret)), `the page can read the ${what}`).toEqual([]);
  }
  expect(seen.length, "the search found nothing at all; it isn't looking").toBeGreaterThan(10);
});

// request() is limited to APP_ROUTES (@wombat/shared/routes), checked in main before any network call. A refusal
// rejects the call (it never comes back as a service answer). The /shutdown variants show that nothing reached the
// service: one that did would end it.
const bridgeRefusesOtherRoutes = ({ sandbox }: { sandbox: Sandbox }): Promise<void> =>
  test.step("the bridge refuses, in main, every method and path outside the app's routes, and none reaches the service", async () => {
  const { page } = opened();
  await waitForConnection(page, "connected");
  const file = await sandbox.waitForService();
  const outside: [string, string][] = [
    ["POST", "/shutdown"],
    ["POST", "/shutdown?now=1"],
    ["POST", "/agents/x/../../shutdown"],
    ["POST", "/agents/%2e%2e/%2e%2e/shutdown"],
    ["POST", `http://127.0.0.1:${String(file.port)}/shutdown`],
    ["POST", `//127.0.0.1:${String(file.port)}/shutdown`],
    ["POST", "/mcp"],
    // Main reads the alert stream itself; the page gets alerts through onAlert.
    ["GET", "/events"],
    ["GET", "/no-such-route"],
    ["PUT", "/agents"],
    // A listed path with another method, a parameter spanning segments, a listed path with more after it.
    ["GET", "/agents/x/stop"],
    ["GET", "/agents/x/y/log"],
    ["POST", "/agents/x/stop/more"],
  ];
  const answers: Record<string, unknown> = {};
  for (const [method, pathname] of outside) {
    const answer = await bridgeRequest(page, method, pathname);
    if (answer.ok) answers[`${method} ${pathname}`] = answer;
  }
  expect(answers, "these went through instead of being refused in main").toEqual({});

  expect(isAlive(file.pid), "a refused request reached the service and shut it down").toBe(true);
  expect(sandbox.discovery()?.pid).toBe(file.pid);
  expect((await sandbox.api("GET", "/version")).status).toBe(200);
  // Control: a listed route goes through.
  expect(await bridgeRequest(page, "GET", "/version")).toMatchObject({ ok: true, status: 200 });
});

// command() runs only the ids in MAIN_COMMAND_IDS (src/shared/bridge.ts), checked in main: anything else rejects and
// runs nothing. Each refused value is a near miss of zoom.in or window.close, so a command that ran anyway would show
// as a changed zoom level, a level heard through onZoom, or a closed window.
const bridgeRefusesOtherCommands = (): Promise<void> =>
  test.step("the bridge refuses, in main, every command id outside MAIN_COMMAND_IDS, and runs nothing for it", async () => {
  const { app, page } = opened();
  await watchZoom(page);
  expect(await zoomLevel(app), "a fresh profile starts at zoom level 0").toBe(0);
  const outside: unknown[] = [
    "zoom.in ",
    "ZOOM.IN",
    "zoom",
    "app.relaunch",
    "view.split.right",
    "__proto__",
    "toString",
    "constructor",
    "",
    42,
    null,
    { id: "zoom.in" },
    ["zoom.in"],
    ["window.close"],
  ];
  const answers: Record<string, string> = {};
  for (const id of outside) answers[JSON.stringify(id)] = await bridgeCommand(page, id);
  const notRefused = Object.entries(answers).filter(([, answer]) => !answer.startsWith("rejected"));
  expect(notRefused, "these went through instead of being refused in main").toEqual([]);
  expect(await zoomLevel(app), "a refused id changed the zoom").toBe(0);
  expect(await zoomsHeard(page), "a refused id zoomed").toEqual([]);
  expect(await windowCount(app), "a refused id closed the window").toBe(1);

  // Control: a listed id runs, and the witnesses above would have seen it.
  expect(await bridgeCommand(page, "zoom.in")).toBe("resolved");
  await waitUntil("zoom.in to change the zoom level", WAIT_MS, async () => ((await zoomLevel(app)) !== 0 ? true : undefined));
  expect(await bridgeCommand(page, "zoom.reset")).toBe("resolved");
  await waitUntil("zoom.reset to bring the level back to 0", WAIT_MS, async () => ((await zoomLevel(app)) === 0 ? true : undefined));
});

// The page's clipboard commands (edit.cut, edit.copy, edit.paste) run only right after the user's own input to the
// window, checked in main, so script in the page can't read or write the clipboard on its own. No input has reached
// the window since launch; the field is the test's own, focused by script.
const pasteNeedsUserInput = (): Promise<void> =>
  test.step("the page's edit.paste pastes nothing with no user input, and pastes right after a key press", async () => {
  const { app, page } = opened();
  const field = page.getByTestId("e2e-clipboard-field");
  await page.evaluate(() => {
    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-testid", "e2e-clipboard-field");
    textarea.style.cssText = "position:fixed;left:40px;top:40px;width:400px;height:120px;z-index:2147483647";
    document.body.appendChild(textarea);
    textarea.focus();
  });
  const onClipboard = "pasted-from-main-5d2e";
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), onClipboard);

  const unasked = await bridgeCommand(page, "edit.paste");

  // Control: main runs the two pastes in order, so a first paste that went through shows as the text twice.
  await page.keyboard.press("End");
  expect(await bridgeCommand(page, "edit.paste"), "the paste right after a key press").toBe("resolved");
  await waitUntil("the paste after the key press to reach the field", WAIT_MS, async () => ((await field.inputValue()).includes(onClipboard) ? true : undefined));
  expect(await field.inputValue(), `edit.paste with no user input went through (it answered ${unasked})`).toBe(onClipboard);
});

// One launch per group: the checks in a group read an untouched app and don't disturb each other in this order.
// Paste comes first (it needs no input since launch); the probes that open windows, navigate or start an agent come last.
test("the window, the preload bridge and permissions are locked down", async () => {
  test.setTimeout(90_000);
  await pasteNeedsUserInput();
  await windowIsLockedDown();
  await preloadExposesOnlyTheBridge();
  await permissionsAreDenied();
  await windowOpenOpensNothing();
  await outsideNavigationStaysOnApp();
});

test("the page's CSP is served on every response and enforced", async () => {
  test.setTimeout(90_000);
  await pageHasOneStrictCsp();
  await otherResponsesCarryAPolicy();
  await loadingCausesNoViolations();
  await pageEnforcesItsCsp();
});

test("the page reaches the service only through main: no token in the page, no route or command outside the allow-lists", async ({ sandbox }) => {
  test.setTimeout(90_000);
  await bridgeRefusesOtherRoutes({ sandbox });
  await bridgeRefusesOtherCommands();
  await pageHoldsNoToken({ sandbox });
});
