import type { ConfigOption } from "@wombat/shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ModeButton } from "../ModeButton/ModeButton.tsx";
import { SettingsButton, settingsLabel } from "./SettingsButton.tsx";

const select = (id: string, category: string, currentValue: string, names: Record<string, string>): ConfigOption => ({
  id,
  name: id,
  type: "select",
  category,
  currentValue,
  options: Object.entries(names).map(([value, name]) => ({ value, name })),
});

const model = select("m", "model", "o", { o: "Opus 5.5" });
const effort = select("e", "thought_level", "h", { h: "High" });
const mode = select("mode", "mode", "ask", { ask: "Ask before edits" });

test("the settings button names the model and the effort, else says Settings", () => {
  expect(settingsLabel([mode, model, effort])).toBe("Opus 5.5 · High");
  expect(settingsLabel([effort])).toBe("High");
  expect(settingsLabel([mode])).toBe("Settings");
  expect(settingsLabel(undefined)).toBe("Settings");
});

test("the Mode button shows the current mode, and is absent without a mode option", () => {
  const render = (config: ConfigOption[] | undefined) => renderToStaticMarkup(<ModeButton config={config} setConfig={() => Promise.resolve()} />);
  expect(render([model, mode])).toContain("Ask before edits");
  expect(render([model])).toBe("");
  expect(render(undefined)).toBe("");
});

test("the buttons say what they are and that they open a dialog", () => {
  const set = () => Promise.resolve();
  const settings = renderToStaticMarkup(<SettingsButton config={[mode, model, effort]} setConfig={set} />);
  expect(settings).toContain('aria-label="Settings: Opus 5.5 · High"');
  expect(settings).toContain('aria-haspopup="dialog"');
  const modeButton = renderToStaticMarkup(<ModeButton config={[mode]} setConfig={set} />);
  expect(modeButton).toContain('aria-label="Mode: Ask before edits"');
  expect(modeButton).toContain('aria-haspopup="dialog"');
  expect(renderToStaticMarkup(<SettingsButton config={[mode]} setConfig={set} />)).toBe("");
});

test("both buttons are disabled for an agent that can't be started again and still show their values", () => {
  const set = () => Promise.resolve();
  const html = renderToStaticMarkup(
    <>
      <SettingsButton config={[model, effort]} setConfig={set} access="closed" />
      <ModeButton config={[mode]} setConfig={set} access="closed" />
    </>,
  );
  expect(html.match(/ disabled=""/g)).toHaveLength(2);
  expect(html).toContain("Opus 5.5 · High");
  expect(html).toContain("Ask before edits");
  expect(renderToStaticMarkup(<SettingsButton config={[model]} setConfig={set} />)).not.toContain(" disabled=");
});

// S2d (D26): a set on an agent without a process starts it, so its buttons stay usable and say so while it starts.
test("for an agent a set starts again, both buttons stay enabled, and say Starting… while a set waits", () => {
  const set = () => Promise.resolve();
  const resumable = renderToStaticMarkup(
    <>
      <SettingsButton config={[model, effort]} setConfig={set} access="resumable" />
      <ModeButton config={[mode]} setConfig={set} access="resumable" />
    </>,
  );
  expect(resumable).not.toContain(" disabled=");
  expect(resumable).toContain("Opus 5.5 · High");
  const starting = renderToStaticMarkup(
    <>
      <SettingsButton config={[model, effort]} setConfig={set} access="resumable" starting />
      <ModeButton config={[mode]} setConfig={set} access="resumable" starting />
    </>,
  );
  expect(starting).toContain('aria-label="Settings: Starting…"');
  expect(starting).toContain('aria-label="Mode: Starting…"');
});
