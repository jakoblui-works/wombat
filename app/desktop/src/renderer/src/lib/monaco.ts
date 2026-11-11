// Placeholder until the diff editor's setup is decided: Monaco can't run under the page's CSP as
// it is (no nonce for its <style> elements, style="" attributes in its line rendering).
type Disposable = { dispose: () => void };
type DiffEditor = Disposable & { setModel: (model: { original: Disposable; modified: Disposable }) => void };

const pending = (): never => {
  throw new Error("diff editor pending decision D9");
};

export const monaco: {
  editor: {
    createModel: (text: string, language: string) => Disposable;
    createDiffEditor: (host: HTMLElement, options: Record<string, unknown>) => DiffEditor;
  };
} = { editor: { createModel: pending, createDiffEditor: pending } };
