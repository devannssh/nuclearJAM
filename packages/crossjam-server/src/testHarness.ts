import type {
  JamClientMessageInput,
  JamRoomSettings,
  JamServerMessage,
  JamTrack,
} from '@nuclearplayer/model';

import { JamServer } from './jamServer';
import { createMemoryPersistence } from './persistence';
import type { Persistence } from './types';

type MessageOf<T extends JamServerMessage['type']> = Extract<
  JamServerMessage,
  { type: T }
>;

export type TestClient = ReturnType<typeof createClient>;

const createClient = (server: JamServer, name: string, genres: string[]) => {
  const userId = `user-${name}-id`;
  const secret = `secret-${name}`.padEnd(16, '-');
  let received: JamServerMessage[] = [];
  let sessionId = '';
  let closed = false;

  const open = (): void => {
    closed = false;
    sessionId = server.connect({
      send: (message) => received.push(structuredClone(message)),
      close: () => {
        closed = true;
      },
    });
  };

  const client = {
    userId,
    get closed() {
      return closed;
    },
    get messages() {
      return received;
    },
    send: (message: JamClientMessageInput): void => {
      server.receive(sessionId, message);
    },
    hello: (): void => {
      client.send({
        type: 'hello',
        userId,
        secret,
        displayName: name,
        genres,
      });
    },
    last: <T extends JamServerMessage['type']>(
      type: T,
    ): MessageOf<T> | undefined =>
      [...received].reverse().find((message) => message.type === type) as
        MessageOf<T> | undefined,
    all: <T extends JamServerMessage['type']>(type: T): MessageOf<T>[] =>
      received.filter((message) => message.type === type) as MessageOf<T>[],
    errorCodes: (): string[] =>
      client.all('error').map((message) => message.code),
    clear: (): void => {
      received = [];
    },
    disconnect: (): void => server.disconnect(sessionId),
    reconnect: (): void => {
      open();
      client.hello();
    },
    room: () =>
      client.last('room.state')?.room ?? client.last('room.joined')?.room,
  };

  open();
  return client;
};

export const defaultSettings = (
  overrides: Partial<JamRoomSettings> = {},
): JamRoomSettings => ({
  name: 'Late Night',
  genres: ['house'],
  privacy: 'public',
  capacity: 10,
  skipMode: 'anyone',
  ...overrides,
});

export const track = (id: string, durationMs?: number): JamTrack => ({
  title: `Song ${id}`,
  artists: ['Artist'],
  durationMs,
  source: { provider: 'test', id },
});

export const createHarness = (
  persistence: Persistence = createMemoryPersistence(),
) => {
  const server = new JamServer({ persistence });
  return {
    server,
    persistence,
    connect: (name: string, genres: string[] = []) => {
      const client = createClient(server, name, genres);
      client.hello();
      return client;
    },
    connectUnidentified: (name: string) => createClient(server, name, []),
  };
};
