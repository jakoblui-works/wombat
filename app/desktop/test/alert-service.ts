// A service in this process for the connection's tests: it answers GET /version (with the API version it's given)
// and GET /events to its token, writes the sandbox's discovery file, and lets a test send stream lines, count the
// /version tries and stop it the way a crash would (connections cut, discovery file left behind).
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { onTestFinished } from "vitest";

import { API_VERSION } from "@wombat/shared";
import type { DiscoveryFile } from "@wombat/shared/discovery";
import { writePrivateFile } from "@wombat/shared/private-file";

import type { ServiceSandbox } from "./service-sandbox.ts";

export type AlertService = {
  file: DiscoveryFile;
  /** Writes `data: <json>` to every open stream. */
  send: (data: unknown) => void;
  /** Writes `text` as is to every open stream. */
  sendRaw: (text: string) => void;
  /** Open /events streams. */
  streams: () => number;
  /** When each GET /version came in (ms since the epoch). */
  versionTries: () => number[];
  /** Closes the port and cuts every connection; the discovery file stays, as after a crash. */
  kill: () => Promise<void>;
};

export type AlertServiceOptions = {
  /** The API version GET /version answers. */
  apiVersion?: number;
  /** GET /events answers 503, as a service that can't take another stream. */
  refuseStream?: boolean;
  /** GET /events opens the stream and ends it at once. */
  closeStream?: boolean;
};

export const alertService = async (sandbox: ServiceSandbox, { apiVersion = API_VERSION, refuseStream = false, closeStream = false }: AlertServiceOptions = {}): Promise<AlertService> => {
  const token = "alert-service-token-0123456789";
  const streams = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  const versionTries: number[] = [];
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
    } else if (req.method === "GET" && req.url === "/version") {
      versionTries.push(Date.now());
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ apiVersion }));
    } else if (req.method === "GET" && req.url === "/events" && refuseStream) {
      res.writeHead(503).end();
    } else if (req.method === "GET" && req.url === "/events" && closeStream) {
      res.writeHead(200, { "content-type": "text/event-stream" }).end();
    } else if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      streams.add(res);
      res.once("close", () => streams.delete(res));
    } else {
      res.writeHead(404).end();
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let killed = false;
  const kill = async () => {
    if (killed) return;
    killed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  onTestFinished(kill);
  const file: DiscoveryFile = { apiVersion, port: (server.address() as AddressInfo).port, pid: process.pid, token };
  writePrivateFile(sandbox.discoveryPath, JSON.stringify(file));
  return {
    file,
    send: (data) => {
      for (const res of streams) res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    sendRaw: (text) => {
      for (const res of streams) res.write(text);
    },
    streams: () => streams.size,
    versionTries: () => [...versionTries],
    kill,
  };
};
