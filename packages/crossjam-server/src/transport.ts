import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';

import { JamServer } from './jamServer';
import type { Persistence } from './types';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export type TransportOptions = {
  port: number;
  host?: string;
  persistence: Persistence;
};

export type RunningTransport = {
  server: Server;
  jam: JamServer;
  port: number;
  close: () => Promise<void>;
};

export const startTransport = async (
  options: TransportOptions,
): Promise<RunningTransport> => {
  const jam = new JamServer({ persistence: options.persistence });
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: jam.roomCount }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const sockets = new WebSocketServer({
    server,
    path: '/jam',
    maxPayload: MAX_PAYLOAD_BYTES,
  });
  const alive = new WeakSet<object>();

  sockets.on('connection', (socket) => {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));

    const sessionId = jam.connect({
      send: (message) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      },
      close: () => socket.close(),
    });

    socket.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        parsed = null;
      }
      jam.receive(sessionId, parsed);
    });
    socket.on('close', () => jam.disconnect(sessionId));
    socket.on('error', () => socket.terminate());
  });

  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  await new Promise<void>((resolve) =>
    server.listen(options.port, options.host, resolve),
  );
  const address = server.address();
  const port =
    typeof address === 'object' && address ? address.port : options.port;

  return {
    server,
    jam,
    port,
    close: async () => {
      clearInterval(heartbeat);
      jam.dispose();
      for (const socket of sockets.clients) {
        socket.terminate();
      }
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
