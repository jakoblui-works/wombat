// Imported first by main.tsx: zod probes `new Function` when a schema is built, which the page's CSP blocks and
// reports as a violation, and the app's modules build their schemas as they load.
import { z } from "zod";

z.config({ jitless: true });
