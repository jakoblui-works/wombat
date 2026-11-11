import { PROPOSAL_ALERT, type Alert } from "@wombat/shared/api";

import type { Committed, Manager } from "../agents/manager.ts";

const encoder = new TextEncoder();

/**
 * Alerts (and pings) a client may have waiting in its stream before the stream is ended. Past it the client has
 * stopped reading: keeping on queueing would grow the service's memory for a window that may never read again.
 * Once it reads the ones queued it sees the stream end, reconnects and catches up from the last seq it got.
 */
export const MAX_QUEUED_ALERTS = 1_000;

export type AlertStreamsOptions = {
  onCommitted: Manager["onCommitted"];
  dbId: string;
  heartbeatMs: number;
};

/**
 * `GET /events`: one alert per committed change, from the moment the stream is opened (no replay; the app
 * catches up through the log route). Alerts carry ids and seqs only, never agent content.
 */
export const createAlertStreams = ({ onCommitted, dbId, heartbeatMs }: AlertStreamsOptions) => {
  const open = new Set<() => void>();

  const respond = () => {
    let end = () => {};
    const body = new ReadableStream<Uint8Array>({
      // Runs inside the constructor, so the stream is subscribed before the response (and its headers) exists:
      // a change committed right after the app sees the headers is never missed.
      start: (controller) => {
        let ended = false;
        const write = (text: string) => {
          if (ended) return;
          // With a high-water mark of 0, the queue holds exactly -desiredSize chunks.
          if (-(controller.desiredSize ?? 0) >= MAX_QUEUED_ALERTS) return close();
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            end();
          }
        };
        const unsubscribe = onCommitted((event: Committed) => {
          const alert: Alert =
            event.type === PROPOSAL_ALERT
              ? { seq: event.seq, dbId, type: event.type, proposalId: event.proposalId }
              : { seq: event.seq, dbId, type: event.type, agentId: event.agentId };
          write(`id: ${event.seq}\ndata: ${JSON.stringify(alert)}\n\n`);
        });
        const heartbeat = setInterval(() => write(": ping\n"), heartbeatMs);
        const close = () => {
          if (ended) return;
          end();
          try {
            controller.close();
          } catch {
            // The client is gone already.
          }
        };
        end = () => {
          if (ended) return;
          ended = true;
          unsubscribe();
          clearInterval(heartbeat);
          open.delete(close);
        };
        open.add(close);
      },
      // The client dropped the connection: nothing may be written to it any more.
      cancel: () => end(),
    }, new CountQueuingStrategy({ highWaterMark: 0 }));
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        // Sends the headers at once instead of waiting for the first chunk.
        "transfer-encoding": "chunked",
      },
    });
  };

  /** Ends every open stream (the server is closing). */
  const closeAll = () => {
    for (const close of [...open]) close();
  };

  return { respond, closeAll };
};
