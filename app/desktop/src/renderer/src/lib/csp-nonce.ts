// The page's CSP nonce for <style> elements, which the page's server writes into the csp-nonce
// meta per response. Every library that injects <style> takes it from here.
export const cspNonce = (): string => {
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
  if (!nonce) {
    throw new Error("The page has no csp-nonce meta, so styles can't load; check src/renderer/index.html and rebuild.");
  }
  return nonce;
};
