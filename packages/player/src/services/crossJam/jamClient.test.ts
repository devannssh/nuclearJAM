import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JamServerMessage } from '@nuclearplayer/model';

import { JamClient } from './jamClient';
import type { JamSocket } from './jamClient';

class FakeSocket implements JamSocket {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.();
  }

  receive(message: JamServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  drop() {
    this.onclose?.();
  }

  sentTypes() {
    return this.sent.map((raw) => JSON.parse(raw).type as string);
  }
}

const hello = () => ({
  type: 'hello' as const,
  userId: 'user-12345',
  secret: 'secret-1234567890',
  displayName: 'Sam',
  genres: [],
});

const welcome = (serverTime: number): JamServerMessage => ({
  type: 'welcome',
  userId: 'user-12345',
  friendCode: 'ABCDEFGH',
  serverTime,
  resumedRoomId: null,
});

describe('JamClient', () => {
  let sockets: FakeSocket[];
  let client: JamClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    sockets = [];
    client = new JamClient({
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
  });

  it('sends hello when the socket opens and becomes connected on welcome', () => {
    const statuses: string[] = [];
    client.onStatus((status) => statuses.push(status));

    client.connect('ws://server/jam', hello);
    expect(client.status).toBe('connecting');
    sockets[0].open();
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({
      type: 'hello',
      displayName: 'Sam',
    });

    sockets[0].receive(welcome(10_000));

    expect(client.status).toBe('connected');
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('refuses to send anything but hello until connected', () => {
    client.connect('ws://server/jam', hello);
    sockets[0].open();

    expect(client.send({ type: 'rooms.list' })).toBe(false);

    sockets[0].receive(welcome(10_000));
    expect(client.send({ type: 'rooms.list' })).toBe(true);
    expect(sockets[0].sentTypes()).toContain('rooms.list');
  });

  it('forwards server messages to listeners and ignores garbage', () => {
    const received: JamServerMessage[] = [];
    client.onMessage((message) => received.push(message));
    client.connect('ws://server/jam', hello);
    sockets[0].open();

    sockets[0].onmessage?.({ data: 'not json' });
    sockets[0].onmessage?.({ data: JSON.stringify({ nope: true }) });
    sockets[0].receive(welcome(10_000));

    expect(received.map((message) => message.type)).toEqual(['welcome']);
  });

  it('estimates the server clock offset from welcome and pongs', () => {
    client.connect('ws://server/jam', hello);
    sockets[0].open();

    sockets[0].receive(welcome(15_000));
    expect(client.serverNow()).toBe(15_000);

    vi.setSystemTime(20_000);
    const pings = sockets[0].sent
      .map((raw) => JSON.parse(raw))
      .filter((message) => message.type === 'ping');
    expect(pings.length).toBeGreaterThan(0);

    vi.setSystemTime(20_100);
    sockets[0].receive({
      type: 'pong',
      clientTime: 20_000,
      serverTime: 25_050,
    });

    expect(client.serverNow()).toBe(20_100 + 5000);
  });

  it('reconnects with backoff after the connection drops', () => {
    client.connect('ws://server/jam', hello);
    sockets[0].open();
    sockets[0].receive(welcome(10_000));

    sockets[0].drop();
    expect(client.status).toBe('connecting');
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sockets[1].drop();

    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it('resets the backoff after a successful welcome', () => {
    client.connect('ws://server/jam', hello);
    sockets[0].drop();
    vi.advanceTimersByTime(1000);
    sockets[1].drop();
    vi.advanceTimersByTime(2000);
    sockets[2].open();
    sockets[2].receive(welcome(10_000));

    sockets[2].drop();
    vi.advanceTimersByTime(1000);

    expect(sockets).toHaveLength(4);
  });

  it('stops reconnecting after an intentional disconnect', () => {
    client.connect('ws://server/jam', hello);
    sockets[0].open();
    sockets[0].receive(welcome(10_000));

    client.disconnect();
    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(true);
    expect(client.status).toBe('disconnected');
  });

  it('opens a new connection when the server URL changes', () => {
    client.connect('ws://one/jam', hello);
    client.connect('ws://two/jam', hello);

    expect(sockets).toHaveLength(2);
    expect(sockets[0].closed).toBe(true);
  });
});
