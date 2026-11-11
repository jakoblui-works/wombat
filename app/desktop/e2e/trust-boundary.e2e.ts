// The app's trust boundary, checked against the built app (`out/main/index.js`, rebuilt by
// `global-setup.ts` before every run). Each test launches its own app in its own sandbox
// (app-fixtures.ts: display-less, `WOMBAT_E2E=1`, temp dirs, fake systemd and fake agents).
import type { ElectronApplication, Page, Response } from "@playwright/test";
import { API_VERSION } from "@wombat/shared";
import { bridgeRequest, expect, isAlive, REPO, test, waitForConnection, type Sandbox } from "./app-fixtures.ts";

// Everything the preload may expose to the page. Adding a global, a name or a function widens
// what a page (and anything that gets into it) can reach in the host: each is a deliberate,
// reviewed decision, made here and in the preload together.
// The globals the preload adds to the page (beyond what a blank page of the same engine has).
const ALLOWED_BRIDGE_GLOBALS = ["wombat"];
// The names on `window.wombat`.
// (interface-S3, T6: the bridge's shape is `WombatBridge` in desktop/src/shared/bridge.ts.)
const ALLOWED_BRIDGE_NAMES = ["apiVersion", "service", "workspace", "settings", "onOpenAgent"];
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
];

// An outside https URL. Requests to it are answered locally (see `stubOutside`),
// so if the app let it load it would load, with or without a network.
const OUTSIDE_URL = "https://example.com/";
const OUTSIDE_PATTERN = "https://example.com/**";
// How long a blocked action gets to take effect before we look.
const SETTLE_MS = 2_000;

// The only sources the page's CSP (contract "Page CSP") may use: 'self' and 'none' anywhere, the
// style nonce only where <style> elements are governed, data: only for images. Anything else (a
// host, a scheme, a hash, a dev nonce, 'unsafe-*', 'strict-dynamic') is a relaxation.
const isNonce = (source: string): boolean => /^'nonce-[^']+'$/.test(source);
const NONCE_DIRECTIVES = ["style-src-elem", "style-src"];
const DATA_DIRECTIVES = ["img-src"];
const allowedSource = (directive: string, source: string): boolean =>
  source === "'self'" ||
  source === "'none'" ||
  (isNonce(source) && NONCE_DIRECTIVES.includes(directive)) ||
  (source === "data:" && DATA_DIRECTIVES.includes(directive));
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
  // Styles: <style>/<link> elements need 'self' or the page's nonce; style="" attributes are never
  // allowed (CSSOM styles, i.e. React style props, are not governed by CSP).
  const styles = d.get("style-src") ?? defaults ?? [];
  const styleElems = d.get("style-src-elem") ?? styles;
  const elemOthers = styleElems.filter((source) => source !== "'self'" && !isNonce(source));
  if (!styleElems.includes("'self'") || styleElems.filter(isNonce).length !== 1 || elemOthers.length > 0) {
    problems.push(`style-src-elem (effective) is not exactly 'self' and one nonce: ${styleElems.join(" ")}`);
  }
  exactly("style-src-attr", d.get("style-src-attr") ?? styles, "'none'");
  return problems;
};

// The CSP policies a response carries (each header may hold several, comma-separated).
const servedPolicies = async (response: Response): Promise<string[]> =>
  (await response.headersArray())
    .filter(({ name }) => name.toLowerCase() === "content-security-policy")
    .flatMap(({ value }) => value.split(","))
    .map((policy) => policy.trim())
    .filter((policy) => policy !== "");

// The nonces a policy gives <style> elements (style-src-elem, or style-src when that's absent),
// in their original case (`directives` lower-cases sources).
const styleNonces = (policy: string): string[] => {
  const parts = policy.split(";").map((part) => part.trim().split(/\s+/));
  const named = (name: string): string[] | undefined => parts.find(([first]) => first?.toLowerCase() === name)?.slice(1);
  const sources = named("style-src-elem") ?? named("style-src") ?? [];
  return sources.flatMap((source) => /^'nonce-([^']+)'$/i.exec(source)?.[1] ?? []);
};

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

// Let the tasks queued during load (effects, injected styles) run. (Not requestAnimationFrame:
// the window is hidden, so frames may never come.)
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

test("the page shows the API version that @wombat/shared exports", async () => {
  const { page } = opened();
  const version = String(API_VERSION);
  await expect(page.getByTestId("api-version")).toHaveText(new RegExp(`(^|\\D)${version}(\\D|$)`));
});

test("the app's window has context isolation and the sandbox on, and Node off", async () => {
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

test("window.open from the renderer opens no window", async () => {
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

test("navigating the page to an outside https URL leaves it on the app", async () => {
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

// The policy comes from the app:// handler as a response header (contract "Page CSP"), never a
// meta tag; this reads what the handler sent, not a copy of the string.
test("the page is served with one strict CSP header, and no CSP meta tag", async () => {
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

test("every load of the page gets a fresh nonce, 128 bits or more, which the csp-nonce meta carries", async () => {
  const { page } = opened();
  const loads: { header: string[]; meta: string | null }[] = [];
  for (let i = 0; i < 2; i++) {
    const policies = await servedPolicies(await reloadPage(page));
    expect(policies, "the page's response doesn't carry exactly one CSP policy").toHaveLength(1);
    loads.push({ header: styleNonces(policies[0] ?? ""), meta: await metaNonce(page) });
  }
  for (const { header, meta } of loads) {
    expect(header, "the served CSP has no single style nonce").toHaveLength(1);
    expect(meta, "the csp-nonce meta doesn't carry the header's nonce").toBe(header[0]);
    const nonce = header[0] ?? "";
    expect(nonce, "the nonce isn't base64").toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(nonce, "base64").length, `the nonce ${nonce} has fewer than 128 bits`).toBeGreaterThanOrEqual(16);
  }
  expect(loads[0]?.header[0], "two loads got the same nonce").not.toBe(loads[1]?.header[0]);
});

test("the page enforces its CSP: inline scripts, un-nonced <style> and style attributes are blocked; nonced <style> and CSSOM styles apply", async () => {
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
    markupStyleAttribute: false,
    setAttributeStyle: false,
    cssomStyle: true,
    styleWithoutNonce: false,
    styleWithNonce: true,
  });
});

test("loading the page causes no CSP violations", async () => {
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

test("the preload bridge exposes only the allowed globals, names and functions", async () => {
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
      .sort();

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
  expect(bridge).toEqual({
    added: [...ALLOWED_BRIDGE_GLOBALS].sort(),
    names: [...ALLOWED_BRIDGE_NAMES].sort(),
    functions: [...ALLOWED_BRIDGE_FUNCTIONS].sort(),
  });
});

test("permission requests and checks from the renderer are denied", async () => {
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

// T6 (D1): the token lives in main only. Searched everywhere the page can read: the globals the page adds, the bridge
// itself, everything the bridge answers or sends (settings, workspace, service answers, a refusal's message,
// connection states), storage, cookies and the document. The port and the discovery file's path count too: the
// page never needs them.
test("the page holds no token, service address or discovery path: not in its globals, the bridge, its storage or its document", async ({ sandbox }) => {
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

// T6: request() is limited to APP_ROUTES (@wombat/shared/routes), checked in main before any network call. A refusal
// rejects the call (it never comes back as a service answer). The /shutdown variants show that nothing reached the
// service: one that did would end it.
test("the bridge refuses, in main, every method and path outside the app's routes, and none reaches the service", async ({ sandbox }) => {
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
