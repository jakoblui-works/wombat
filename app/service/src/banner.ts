import { API_VERSION } from "@wombat/shared";

/** The line the service prints on start. */
export const banner = (version: number = API_VERSION): string =>
  `wombat service, api ${String(version)}`;
