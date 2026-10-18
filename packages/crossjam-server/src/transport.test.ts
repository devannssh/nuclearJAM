import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { JamServerMessage } from '@nuclearplayer/model';

import { createMemoryPersistence } from './persistence';
import { startTransport } from './transport';
import type { RunningTransport } from './transport';

const open = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/jam`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });

const nextMessage = (socket: WebSocket): Promise<JamServerMessage> =>
  new Promise((resolve) => {
    socket.once('message', (data) =>
      resolve(JSON.parse(data.toString()) as JamServerMessage),
    );
  });

describe('WebSocket transport', () => {
  let running: RunningTransport | null = null;

  afterEach(async () => {
    await running?.close();
    running = null;
  });

  it('lets two real clients meet in a room over WebSocket', async () => {
    running = await startTransport({
      port: 0,
      host: '127.0.0.1',
      persistence: createMemoryPersistence(),
    });
    const alice = await open(running.port);
    const bob = await open(running.port);

    alice.send(
      JSON.stringify({
        type: 'hello',
        userId: 'alice-user-id',
        secret: 'alice-secret-1234567',
        displayName: 'Alice',
        genres: ['house'],
      }),
    );
    expect((await nextMessage(alice)).type).toBe('welcome');

    alice.send(
      JSON.stringify({
        type: 'room.create',
        settings: {
          name: 'Socket Room',
          genres: ['house'],
          privacy: 'public',
          capacity: 5,
          skipMode: 'anyone',
        },
      }),
    );
    const joined = await nextMessage(alice);
    expect(joined.type).toBe('room.joined');

    bob.send(
      JSON.stringify({
        type: 'hello',
        userId: 'bob-user-id-1',
        secret: 'bob-secret-123456789',
        displayName: 'Bob',
        genres: ['house'],
      }),
    );
    expect((await nextMessage(bob)).type).toBe('welcome');
    bob.send(JSON.stringify({ type: 'rooms.list' }));
    const listing = await nextMessage(bob);
    expect(listing).toMatchObject({
      type: 'rooms',
      rooms: [{ name: 'Socket Room', match: 100, memberCount: 1 }],
    });

    alice.close();
    bob.close();
  });

  it('answers malformed JSON with an error instead of crashing', async () => {
    running = await startTransport({
      port: 0,
      host: '127.0.0.1',
      persistence: createMemoryPersistence(),
    });
    const socket = await open(running.port);

    socket.send('this is not json');

    expect(await nextMessage(socket)).toMatchObject({
      type: 'error',
      code: 'invalid_message',
    });
    socket.close();
  });

  it('serves a health endpoint', async () => {
    running = await startTransport({
      port: 0,
      host: '127.0.0.1',
      persistence: createMemoryPersistence(),
    });

    const response = await fetch(`http://127.0.0.1:${running.port}/health`);

    expect(await response.json()).toEqual({ ok: true, rooms: 0 });
  });
});
