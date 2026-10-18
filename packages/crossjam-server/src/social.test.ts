import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JamClientMessageInput } from '@nuclearplayer/model';

import { createMemoryPersistence } from './persistence';
import { createHarness, defaultSettings } from './testHarness';

const HOUR_MS = 60 * 60 * 1000;

describe('friends', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects two users through a friend request and acceptance', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');

    alice.send({
      type: 'friends.request',
      friendCode: bob.last('welcome')!.friendCode.toLowerCase(),
    });

    expect(bob.last('friends.state')!.incoming).toEqual([
      { userId: alice.userId, displayName: 'alice' },
    ]);
    expect(alice.last('friends.state')!.outgoing).toHaveLength(1);

    bob.send({ type: 'friends.respond', userId: alice.userId, accept: true });

    expect(alice.last('friends.state')!.friends).toEqual([
      {
        userId: bob.userId,
        displayName: 'bob',
        status: 'online',
        roomId: null,
        roomName: null,
      },
    ]);
    expect(bob.last('friends.state')!.incoming).toEqual([]);
  });

  it('accepts automatically when both users request each other', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');

    alice.send({
      type: 'friends.request',
      friendCode: bob.last('welcome')!.friendCode,
    });
    bob.send({
      type: 'friends.request',
      friendCode: alice.last('welcome')!.friendCode,
    });

    expect(alice.last('friends.state')!.friends).toHaveLength(1);
    expect(bob.last('friends.state')!.friends).toHaveLength(1);
  });

  it('rejects unknown codes, self requests and existing friends', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');

    alice.send({ type: 'friends.request', friendCode: 'NOSUCHCODE' });
    alice.send({
      type: 'friends.request',
      friendCode: alice.last('welcome')!.friendCode,
    });
    alice.send({
      type: 'friends.request',
      friendCode: bob.last('welcome')!.friendCode,
    });
    bob.send({ type: 'friends.respond', userId: alice.userId, accept: true });
    alice.send({
      type: 'friends.request',
      friendCode: bob.last('welcome')!.friendCode,
    });

    expect(alice.errorCodes()).toEqual([
      'user_not_found',
      'self_request',
      'already_friends',
    ]);
  });

  it('can decline a request and remove a friend', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');
    alice.send({
      type: 'friends.request',
      friendCode: bob.last('welcome')!.friendCode,
    });

    bob.send({ type: 'friends.respond', userId: alice.userId, accept: false });
    expect(alice.last('friends.state')!.friends).toEqual([]);
    expect(alice.last('friends.state')!.outgoing).toEqual([]);

    alice.send({
      type: 'friends.request',
      friendCode: bob.last('welcome')!.friendCode,
    });
    bob.send({ type: 'friends.respond', userId: alice.userId, accept: true });
    alice.send({ type: 'friends.remove', userId: bob.userId });

    expect(bob.last('friends.state')!.friends).toEqual([]);
  });

  it('shows friends coming online, going offline and which public room they are in', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');
    alice.send({
      type: 'friends.request',
      friendCode: bob.last('welcome')!.friendCode,
    });
    bob.send({ type: 'friends.respond', userId: alice.userId, accept: true });

    bob.send({
      type: 'room.create',
      settings: defaultSettings({ name: 'Bob Beats' }),
    });
    expect(alice.last('friends.state')!.friends[0]).toMatchObject({
      roomName: 'Bob Beats',
      status: 'online',
    });

    bob.disconnect();
    expect(alice.last('friends.state')!.friends[0].status).toBe('offline');
  });

  it('hides which invite-only room a friend is in', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');
    alice.send({
      type: 'friends.request',
      friendCode: bob.last('welcome')!.friendCode,
    });
    bob.send({ type: 'friends.respond', userId: alice.userId, accept: true });

    bob.send({
      type: 'room.create',
      settings: defaultSettings({ name: 'Private', privacy: 'invite' }),
    });

    expect(alice.last('friends.state')!.friends[0]).toMatchObject({
      roomId: null,
      roomName: null,
    });
  });

  it('keeps friendships and friend codes across a server restart', () => {
    const persistence = createMemoryPersistence();
    const first = createHarness(persistence);
    const alice = first.connect('alice');
    const bob = first.connect('bob');
    const aliceCode = alice.last('welcome')!.friendCode;
    alice.send({
      type: 'friends.request',
      friendCode: bob.last('welcome')!.friendCode,
    });
    bob.send({ type: 'friends.respond', userId: alice.userId, accept: true });
    first.server.dispose();

    const second = createHarness(persistence);
    const aliceAgain = second.connect('alice');

    expect(aliceAgain.last('welcome')!.friendCode).toBe(aliceCode);
    aliceAgain.send({ type: 'friends.list' });
    expect(aliceAgain.last('friends.state')!.friends).toMatchObject([
      { userId: bob.userId, status: 'offline' },
    ]);
  });
});

describe('scheduled events', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const eventInput = (
    startsAt: number,
  ): Extract<JamClientMessageInput, { type: 'events.create' }> => ({
    type: 'events.create',
    title: 'Friday Funk',
    description: 'Bring the groove',
    startsAt,
    genres: ['funk'],
    privacy: 'public',
    capacity: 20,
    skipMode: 'vote',
  });

  it('lets a host schedule an event that others can see and RSVP to', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');

    alice.send(eventInput(Date.now() + HOUR_MS));
    bob.send({ type: 'events.list' });

    const [event] = bob.last('events.state')!.events;
    expect(event).toMatchObject({
      title: 'Friday Funk',
      hostName: 'alice',
      status: 'scheduled',
      rsvps: [alice.userId],
    });

    bob.send({ type: 'events.rsvp', eventId: event.id, going: true });
    expect(bob.last('events.state')!.events[0].rsvps).toContain(bob.userId);

    bob.send({ type: 'events.rsvp', eventId: event.id, going: false });
    expect(bob.last('events.state')!.events[0].rsvps).not.toContain(bob.userId);
  });

  it('rejects events in the past', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');

    alice.send(eventInput(Date.now() - HOUR_MS));

    expect(alice.errorCodes()).toEqual(['event_in_past']);
  });

  it('hides invite-only events from people who are not invited', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');
    alice.send({ ...eventInput(Date.now() + HOUR_MS), privacy: 'invite' });

    bob.send({ type: 'events.list' });

    expect(bob.last('events.state')!.events).toEqual([]);
  });

  it('opens a room when the host starts the event and tells attendees', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');
    alice.send(eventInput(Date.now() + HOUR_MS));
    const eventId = alice.last('events.state')!.events[0].id;
    bob.send({ type: 'events.rsvp', eventId, going: true });

    alice.send({ type: 'events.start', eventId });

    const room = alice.last('room.joined')!.room;
    expect(room).toMatchObject({
      name: 'Friday Funk',
      skipMode: 'vote',
      eventId,
    });
    expect(bob.last('event.starting')!.event).toMatchObject({
      id: eventId,
      status: 'live',
      roomId: room.id,
    });
  });

  it('lets only the host start or cancel', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');
    alice.send(eventInput(Date.now() + HOUR_MS));
    const eventId = alice.last('events.state')!.events[0].id;

    bob.send({ type: 'events.start', eventId });
    bob.send({ type: 'events.cancel', eventId });

    expect(bob.errorCodes()).toEqual(['forbidden', 'forbidden']);
  });

  it('cancels an event and removes it from listings', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    alice.send(eventInput(Date.now() + HOUR_MS));
    const eventId = alice.last('events.state')!.events[0].id;

    alice.send({ type: 'events.cancel', eventId });

    expect(alice.last('events.state')!.events).toEqual([]);
  });

  it('reminds the host and attendees when the start time arrives', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    const bob = harness.connect('bob');
    alice.send(eventInput(Date.now() + HOUR_MS));
    const eventId = alice.last('events.state')!.events[0].id;
    bob.send({ type: 'events.rsvp', eventId, going: true });

    vi.advanceTimersByTime(HOUR_MS + 31_000);

    expect(alice.last('event.starting')!.event.id).toBe(eventId);
    expect(bob.last('event.starting')!.event.id).toBe(eventId);
    expect(bob.all('event.starting')).toHaveLength(1);
  });

  it('expires events that are never started', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    alice.send(eventInput(Date.now() + HOUR_MS));

    vi.advanceTimersByTime(5 * HOUR_MS);
    alice.send({ type: 'events.list' });

    expect(alice.last('events.state')!.events).toEqual([]);
  });

  it('marks an event ended once its room closes', () => {
    const harness = createHarness();
    const alice = harness.connect('alice');
    alice.send(eventInput(Date.now() + HOUR_MS));
    const eventId = alice.last('events.state')!.events[0].id;
    alice.send({ type: 'events.start', eventId });

    alice.send({ type: 'room.leave' });
    vi.advanceTimersByTime(3 * 60 * 1000);
    alice.send({ type: 'events.list' });

    expect(alice.last('events.state')!.events).toEqual([]);
  });
});
