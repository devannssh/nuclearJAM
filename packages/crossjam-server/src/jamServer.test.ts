import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JAM_EMPTY_ROOM_TTL_MS,
  JAM_RESUME_GRACE_MS,
} from '@nuclearplayer/model';

import { createHarness, defaultSettings, track } from './testHarness';
import type { TestClient } from './testHarness';

const createRoom = (
  client: TestClient,
  overrides: Parameters<typeof defaultSettings>[0] = {},
): string => {
  client.send({ type: 'room.create', settings: defaultSettings(overrides) });
  return client.last('room.joined')!.room.id;
};

describe('Cross Jam server', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connection', () => {
    it('welcomes an identified user with a friend code', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');

      const welcome = alice.last('welcome')!;
      expect(welcome.userId).toBe(alice.userId);
      expect(welcome.friendCode).toHaveLength(8);
      expect(welcome.resumedRoomId).toBeNull();
    });

    it('rejects commands before hello', () => {
      const harness = createHarness();
      const stranger = harness.connectUnidentified('stranger');

      stranger.send({ type: 'rooms.list' });

      expect(stranger.errorCodes()).toEqual(['not_identified']);
    });

    it('rejects invalid messages', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');

      alice.send({ type: 'room.create' } as never);

      expect(alice.errorCodes()).toEqual(['invalid_message']);
    });

    it('rejects a second session that claims an existing user id with the wrong secret', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const impostor = harness.connectUnidentified('mallory');

      impostor.send({
        type: 'hello',
        userId: alice.userId,
        secret: 'not-the-right-secret',
        displayName: 'Mallory',
        genres: [],
      });

      expect(impostor.errorCodes()).toEqual(['bad_credentials']);
      expect(impostor.closed).toBe(true);
    });

    it('answers pings with the server time', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');

      alice.send({ type: 'ping', clientTime: 123 });

      expect(alice.last('pong')).toEqual({
        type: 'pong',
        clientTime: 123,
        serverTime: Date.now(),
      });
    });

    it('rate limits message floods', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');

      for (let count = 0; count < 100; count += 1) {
        alice.send({ type: 'rooms.list' });
      }

      expect(alice.errorCodes()).toContain('rate_limited');
    });
  });

  describe('rooms', () => {
    it('creates a room with the creator as host', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');

      createRoom(alice);

      const room = alice.room()!;
      expect(room.name).toBe('Late Night');
      expect(room.hostId).toBe(alice.userId);
      expect(room.members).toHaveLength(1);
      expect(room.members[0].role).toBe('host');
    });

    it('rejects duplicate room names regardless of case', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      createRoom(alice, { name: 'Chill' });

      bob.send({
        type: 'room.create',
        settings: defaultSettings({ name: 'CHILL' }),
      });

      expect(bob.errorCodes()).toEqual(['name_taken']);
    });

    it('does not let a user be in two rooms', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      createRoom(alice);

      alice.send({
        type: 'room.create',
        settings: defaultSettings({ name: 'Other' }),
      });

      expect(alice.errorCodes()).toEqual(['already_in_room']);
    });

    it('ranks public rooms by taste match and hides invite rooms', () => {
      const harness = createHarness();
      const rocker = harness.connect('rocker', ['rock', 'metal']);
      const dancer = harness.connect('dancer', ['house', 'techno']);
      const lister = harness.connect('lister', ['house', 'techno']);
      createRoom(rocker, { name: 'Riffs', genres: ['rock', 'metal'] });
      createRoom(dancer, { name: 'Club', genres: ['house', 'techno'] });
      const hidden = harness.connect('hidden', ['house']);
      createRoom(hidden, {
        name: 'Secret',
        genres: ['house', 'techno'],
        privacy: 'invite',
      });

      lister.send({ type: 'rooms.list' });

      const rooms = lister.last('rooms')!.rooms;
      expect(rooms.map((room) => room.name)).toEqual(['Club', 'Riffs']);
      expect(rooms[0].match).toBe(100);
      expect(rooms[1].match).toBe(0);
    });

    it('lets people join a public room and notifies members', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const roomId = createRoom(alice);
      alice.clear();

      bob.send({ type: 'room.join', roomId });

      expect(bob.last('room.joined')!.room.members).toHaveLength(2);
      expect(alice.last('room.state')!.room.members).toHaveLength(2);
      expect(alice.last('chat.message')!.message.text).toBe('joined');
    });

    it('requires the invite code for invite rooms', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const roomId = createRoom(alice, { privacy: 'invite' });
      const code = alice.room()!.inviteCode!;

      bob.send({ type: 'room.join', roomId });
      expect(bob.errorCodes()).toEqual(['invite_required']);

      bob.send({ type: 'room.join', inviteCode: code.toLowerCase() });
      expect(bob.last('room.joined')!.room.id).toBe(roomId);
    });

    it('enforces capacity', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const carol = harness.connect('carol');
      const roomId = createRoom(alice, { capacity: 2 });
      bob.send({ type: 'room.join', roomId });

      carol.send({ type: 'room.join', roomId });

      expect(carol.errorCodes()).toEqual(['room_full']);
    });

    it('lets only the host change settings and keeps invite codes in sync', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const roomId = createRoom(alice);
      bob.send({ type: 'room.join', roomId });

      bob.send({ type: 'room.updateSettings', settings: { capacity: 5 } });
      expect(bob.errorCodes()).toEqual(['forbidden']);

      alice.send({
        type: 'room.updateSettings',
        settings: { privacy: 'invite' },
      });
      expect(alice.room()!.inviteCode).toHaveLength(6);

      alice.send({
        type: 'room.updateSettings',
        settings: { privacy: 'public' },
      });
      expect(alice.room()!.inviteCode).toBeNull();
    });

    it('rejects shrinking capacity below the member count', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const carol = harness.connect('carol');
      const roomId = createRoom(alice);
      bob.send({ type: 'room.join', roomId });
      carol.send({ type: 'room.join', roomId });

      alice.send({ type: 'room.updateSettings', settings: { capacity: 2 } });

      expect(alice.errorCodes()).toEqual(['member_limit']);
      expect(alice.room()!.capacity).toBe(10);
    });
  });

  describe('host handoff and room lifetime', () => {
    it('hands the host role to the longest-connected member', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const carol = harness.connect('carol');
      const roomId = createRoom(alice);
      vi.advanceTimersByTime(1000);
      bob.send({ type: 'room.join', roomId });
      vi.advanceTimersByTime(1000);
      carol.send({ type: 'room.join', roomId });

      alice.send({ type: 'room.leave' });

      const room = carol.room()!;
      expect(room.hostId).toBe(bob.userId);
      expect(
        room.members.find((member) => member.userId === bob.userId)!.role,
      ).toBe('host');
    });

    it('prefers a cohost over a longer-connected plain member', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const carol = harness.connect('carol');
      const roomId = createRoom(alice);
      vi.advanceTimersByTime(1000);
      bob.send({ type: 'room.join', roomId });
      vi.advanceTimersByTime(1000);
      carol.send({ type: 'room.join', roomId });
      alice.send({
        type: 'member.setRole',
        userId: carol.userId,
        role: 'cohost',
      });

      alice.send({ type: 'room.leave' });

      expect(bob.room()!.hostId).toBe(carol.userId);
    });

    it('sends the leaving member a recap', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      createRoom(alice);

      alice.send({ type: 'room.leave' });

      const left = alice.last('room.left')!;
      expect(left.reason).toBe('left');
      expect(left.recap!.roomName).toBe('Late Night');
    });

    it('keeps an empty room alive for two minutes then closes it', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const roomId = createRoom(alice);
      alice.send({ type: 'room.leave' });

      vi.advanceTimersByTime(JAM_EMPTY_ROOM_TTL_MS - 1000);
      expect(harness.server.roomCount).toBe(1);
      bob.send({ type: 'room.join', roomId });
      expect(bob.last('room.joined')).toBeDefined();
      bob.send({ type: 'room.leave' });

      vi.advanceTimersByTime(JAM_EMPTY_ROOM_TTL_MS + 1000);
      expect(harness.server.roomCount).toBe(0);
      alice.send({ type: 'room.join', roomId });
      expect(alice.errorCodes()).toContain('room_not_found');
    });

    it('makes the first person to rejoin an empty room the host', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const roomId = createRoom(alice);
      alice.send({ type: 'room.leave' });

      bob.send({ type: 'room.join', roomId });

      expect(bob.room()!.hostId).toBe(bob.userId);
    });

    it('cancels the closing timer when someone rejoins', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const roomId = createRoom(alice);
      alice.send({ type: 'room.leave' });
      vi.advanceTimersByTime(JAM_EMPTY_ROOM_TTL_MS - 1000);

      alice.send({ type: 'room.join', roomId });
      vi.advanceTimersByTime(JAM_EMPTY_ROOM_TTL_MS * 2);

      expect(harness.server.roomCount).toBe(1);
    });

    it('keeps a seat for a user who reconnects within the grace period', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const roomId = createRoom(alice);
      bob.send({ type: 'room.join', roomId });

      alice.disconnect();
      vi.advanceTimersByTime(JAM_RESUME_GRACE_MS - 1000);
      alice.reconnect();

      expect(alice.last('welcome')!.resumedRoomId).toBe(roomId);
      expect(alice.last('room.joined')!.room.hostId).toBe(alice.userId);
      vi.advanceTimersByTime(JAM_RESUME_GRACE_MS * 2);
      expect(bob.room()!.members).toHaveLength(2);
    });

    it('removes a user who stays disconnected and hands off the host', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const roomId = createRoom(alice);
      bob.send({ type: 'room.join', roomId });

      alice.disconnect();
      expect(
        bob.room()!.members.find((member) => member.userId === alice.userId)!
          .connected,
      ).toBe(false);
      vi.advanceTimersByTime(JAM_RESUME_GRACE_MS + 1000);

      expect(bob.room()!.members).toHaveLength(1);
      expect(bob.room()!.hostId).toBe(bob.userId);
    });

    it('takes over a stale session when the same user connects again', () => {
      const harness = createHarness();
      const first = harness.connect('alice');
      const roomId = createRoom(first);

      first.reconnect();

      expect(first.last('welcome')!.resumedRoomId).toBe(roomId);
      expect(harness.server.roomCount).toBe(1);
    });
  });

  describe('shared queue and playback', () => {
    const setupRoom = (skipMode: 'anyone' | 'vote' | 'host' = 'anyone') => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const carol = harness.connect('carol');
      const roomId = createRoom(alice, { skipMode });
      bob.send({ type: 'room.join', roomId });
      carol.send({ type: 'room.join', roomId });
      return { harness, alice, bob, carol };
    };

    it('starts playing the first added track immediately', () => {
      const { alice, bob } = setupRoom();

      bob.send({ type: 'queue.add', track: track('1') });

      const room = alice.room()!;
      expect(room.current!.track.title).toBe('Song 1');
      expect(room.current!.addedByName).toBe('bob');
      expect(room.playback.playing).toBe(true);
      expect(room.queue).toEqual([]);
    });

    it('queues later tracks and rejects duplicates', () => {
      const { alice, bob } = setupRoom();
      bob.send({ type: 'queue.add', track: track('1') });
      bob.send({ type: 'queue.add', track: track('2') });

      bob.send({ type: 'queue.add', track: track('2') });
      bob.send({ type: 'queue.add', track: track('1') });

      expect(alice.room()!.queue).toHaveLength(1);
      expect(bob.errorCodes()).toEqual(['duplicate_track', 'duplicate_track']);
    });

    it('limits how many tracks a member can have queued', () => {
      const { bob } = setupRoom();
      bob.send({ type: 'queue.add', track: track('current') });

      for (let index = 0; index < 12; index += 1) {
        vi.advanceTimersByTime(1000);
        bob.send({ type: 'queue.add', track: track(`q${index}`) });
      }

      expect(bob.errorCodes()).toEqual(['member_limit', 'member_limit']);
    });

    it('orders upcoming tracks by votes, then by when they were added', () => {
      const { alice, bob, carol } = setupRoom();
      alice.send({ type: 'queue.add', track: track('now') });
      bob.send({ type: 'queue.add', track: track('a') });
      bob.send({ type: 'queue.add', track: track('b') });
      bob.send({ type: 'queue.add', track: track('c') });
      const idOfC = alice.room()!.queue[2].id;

      carol.send({ type: 'queue.vote', itemId: idOfC });
      alice.send({ type: 'queue.vote', itemId: idOfC });

      expect(alice.room()!.queue.map((item) => item.track.title)).toEqual([
        'Song c',
        'Song a',
        'Song b',
      ]);

      carol.send({ type: 'queue.vote', itemId: idOfC });
      alice.send({ type: 'queue.vote', itemId: idOfC });

      expect(alice.room()!.queue.map((item) => item.track.title)).toEqual([
        'Song a',
        'Song b',
        'Song c',
      ]);
    });

    it('lets the adder or a moderator remove a queued track', () => {
      const { alice, bob, carol } = setupRoom();
      alice.send({ type: 'queue.add', track: track('now') });
      bob.send({ type: 'queue.add', track: track('a') });
      carol.send({ type: 'queue.add', track: track('b') });
      const [itemA, itemB] = alice.room()!.queue;

      carol.send({ type: 'queue.remove', itemId: itemA.id });
      expect(carol.errorCodes()).toEqual(['forbidden']);

      bob.send({ type: 'queue.remove', itemId: itemA.id });
      alice.send({ type: 'queue.remove', itemId: itemB.id });

      expect(alice.room()!.queue).toEqual([]);
    });

    it('advances when the host reports the track ended', () => {
      const { alice, bob } = setupRoom();
      bob.send({ type: 'queue.add', track: track('1') });
      bob.send({ type: 'queue.add', track: track('2') });
      const currentId = alice.room()!.current!.id;

      alice.send({ type: 'playback.ended', itemId: currentId });

      expect(alice.room()!.current!.track.title).toBe('Song 2');
      expect(alice.room()!.playback.positionMs).toBe(0);
    });

    it('ignores ended reports for a track that is no longer current', () => {
      const { alice, bob } = setupRoom();
      bob.send({ type: 'queue.add', track: track('1') });
      bob.send({ type: 'queue.add', track: track('2') });
      const staleId = alice.room()!.current!.id;
      alice.send({ type: 'playback.ended', itemId: staleId });

      alice.send({ type: 'playback.ended', itemId: staleId });

      expect(alice.room()!.current!.track.title).toBe('Song 2');
    });

    it('stops playback when the queue runs out', () => {
      const { alice, bob } = setupRoom();
      bob.send({ type: 'queue.add', track: track('1') });

      alice.send({ type: 'playback.ended', itemId: alice.room()!.current!.id });

      expect(alice.room()!.current).toBeNull();
      expect(alice.room()!.playback.playing).toBe(false);
    });

    it('falls back to a timer when no one reports the end of a track', () => {
      const { alice, bob } = setupRoom();
      bob.send({ type: 'queue.add', track: track('1', 60_000) });
      bob.send({ type: 'queue.add', track: track('2', 60_000) });

      vi.advanceTimersByTime(60_000 + 7000);
      expect(alice.room()!.current!.track.title).toBe('Song 1');

      vi.advanceTimersByTime(2000);
      expect(alice.room()!.current!.track.title).toBe('Song 2');
    });

    it('lets only moderators control playback and tracks position over time', () => {
      const { alice, bob } = setupRoom();
      bob.send({ type: 'queue.add', track: track('1', 600_000) });
      const itemId = alice.room()!.current!.id;

      bob.send({
        type: 'playback.update',
        itemId,
        playing: false,
        positionMs: 5000,
      });
      expect(bob.errorCodes()).toEqual(['forbidden']);

      vi.advanceTimersByTime(4000);
      alice.send({
        type: 'playback.update',
        itemId,
        playing: true,
        positionMs: 30_000,
      });

      const state = bob.last('playback.state')!;
      expect(state.currentId).toBe(itemId);
      expect(state.playback).toEqual({
        playing: true,
        positionMs: 30_000,
        updatedAt: Date.now(),
      });
    });

    it('pauses the room clock when the host pauses', () => {
      const { alice, bob } = setupRoom();
      bob.send({ type: 'queue.add', track: track('1', 600_000) });
      const itemId = alice.room()!.current!.id;

      alice.send({
        type: 'playback.update',
        itemId,
        playing: false,
        positionMs: 12_000,
      });
      vi.advanceTimersByTime(60_000);
      alice.send({ type: 'room.recap' });

      expect(bob.last('playback.state')!.playback.positionMs).toBe(12_000);
      expect(bob.last('playback.state')!.playback.playing).toBe(false);
    });

    describe('skipping', () => {
      it('lets anyone skip in anyone mode', () => {
        const { alice, bob } = setupRoom('anyone');
        alice.send({ type: 'queue.add', track: track('1') });
        alice.send({ type: 'queue.add', track: track('2') });

        bob.send({ type: 'playback.skip' });

        expect(alice.room()!.current!.track.title).toBe('Song 2');
      });

      it('restricts skipping to moderators in host mode', () => {
        const { alice, bob } = setupRoom('host');
        alice.send({ type: 'queue.add', track: track('1') });
        alice.send({ type: 'queue.add', track: track('2') });

        bob.send({ type: 'playback.skip' });
        expect(bob.errorCodes()).toEqual(['forbidden']);
        expect(alice.room()!.current!.track.title).toBe('Song 1');

        alice.send({ type: 'playback.skip' });
        expect(alice.room()!.current!.track.title).toBe('Song 2');
      });

      it('skips once a majority votes in vote mode', () => {
        const { alice, bob, carol } = setupRoom('vote');
        alice.send({ type: 'queue.add', track: track('1') });
        alice.send({ type: 'queue.add', track: track('2') });

        bob.send({ type: 'playback.skip' });
        expect(alice.last('playback.state')!.skipVotes).toEqual([bob.userId]);
        expect(alice.room()!.current!.track.title).toBe('Song 1');

        carol.send({ type: 'playback.skip' });
        expect(alice.room()!.current!.track.title).toBe('Song 2');
        expect(alice.room()!.skipVotes).toEqual([]);
      });

      it('lets a vote be withdrawn', () => {
        const { alice, bob } = setupRoom('vote');
        alice.send({ type: 'queue.add', track: track('1') });

        bob.send({ type: 'playback.skip' });
        bob.send({ type: 'playback.skip' });

        expect(alice.last('playback.state')!.skipVotes).toEqual([]);
      });

      it('lets a moderator skip immediately in vote mode', () => {
        const { alice } = setupRoom('vote');
        alice.send({ type: 'queue.add', track: track('1') });
        alice.send({ type: 'queue.add', track: track('2') });

        alice.send({ type: 'playback.skip' });

        expect(alice.room()!.current!.track.title).toBe('Song 2');
      });

      it('re-evaluates votes when a member leaves', () => {
        const { harness, alice, bob, carol } = setupRoom('vote');
        const dave = harness.connect('dave');
        dave.send({ type: 'room.join', roomId: alice.room()!.id });
        alice.send({ type: 'queue.add', track: track('1') });
        alice.send({ type: 'queue.add', track: track('2') });
        bob.send({ type: 'playback.skip' });
        carol.send({ type: 'playback.skip' });
        expect(alice.room()!.current!.track.title).toBe('Song 1');

        dave.send({ type: 'room.leave' });

        expect(alice.room()!.current!.track.title).toBe('Song 2');
      });
    });
  });

  describe('chat and reactions', () => {
    const setupPair = () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const roomId = createRoom(alice);
      bob.send({ type: 'room.join', roomId });
      return { harness, alice, bob, roomId };
    };

    it('delivers chat messages to everyone in the room', () => {
      const { alice, bob } = setupPair();

      bob.send({ type: 'chat.send', text: '  hello room  ' });

      const message = alice.last('chat.message')!.message;
      expect(message.text).toBe('hello room');
      expect(message.displayName).toBe('bob');
      expect(bob.last('chat.message')!.message.id).toBe(message.id);
    });

    it('rate limits chat spam', () => {
      const { bob } = setupPair();

      for (let count = 0; count < 8; count += 1) {
        bob.send({ type: 'chat.send', text: `spam ${count}` });
      }

      expect(bob.errorCodes()).toContain('rate_limited');
    });

    it('sends recent chat history to people who join later', () => {
      const { harness, alice, roomId } = setupPair();
      alice.send({ type: 'chat.send', text: 'before you arrived' });
      const late = harness.connect('late');

      late.send({ type: 'room.join', roomId });

      const texts = late
        .last('room.joined')!
        .chat.map((message) => message.text);
      expect(texts).toContain('before you arrived');
    });

    it('broadcasts reactions and rejects unknown emoji', () => {
      const { alice, bob } = setupPair();

      bob.send({ type: 'reaction.send', emoji: '🔥' });
      bob.send({ type: 'reaction.send', emoji: '💩' } as never);

      expect(alice.last('reaction')).toEqual({
        type: 'reaction',
        userId: bob.userId,
        displayName: 'bob',
        emoji: '🔥',
      });
      expect(bob.errorCodes()).toEqual(['invalid_message']);
    });
  });

  describe('roles and moderation', () => {
    const setupTrio = () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const carol = harness.connect('carol');
      const roomId = createRoom(alice);
      bob.send({ type: 'room.join', roomId });
      carol.send({ type: 'room.join', roomId });
      return { alice, bob, carol, roomId };
    };

    it('lets the host promote a member to cohost', () => {
      const { alice, bob } = setupTrio();

      alice.send({
        type: 'member.setRole',
        userId: bob.userId,
        role: 'cohost',
      });

      expect(
        alice.room()!.members.find((member) => member.userId === bob.userId)!
          .role,
      ).toBe('cohost');
    });

    it('does not let non-hosts change roles', () => {
      const { bob, carol } = setupTrio();

      bob.send({
        type: 'member.setRole',
        userId: carol.userId,
        role: 'cohost',
      });

      expect(bob.errorCodes()).toEqual(['forbidden']);
    });

    it('lets a cohost control playback', () => {
      const { alice, bob } = setupTrio();
      alice.send({
        type: 'member.setRole',
        userId: bob.userId,
        role: 'cohost',
      });
      alice.send({ type: 'queue.add', track: track('1', 600_000) });
      const itemId = alice.room()!.current!.id;

      bob.send({
        type: 'playback.update',
        itemId,
        playing: false,
        positionMs: 1000,
      });

      expect(bob.errorCodes()).toEqual([]);
      expect(alice.last('playback.state')!.playback.playing).toBe(false);
    });

    it('kicks a member and bans them from rejoining for a while', () => {
      const { alice, carol, roomId } = setupTrio();

      alice.send({ type: 'member.kick', userId: carol.userId });

      expect(carol.last('room.left')).toMatchObject({
        reason: 'kicked',
        recap: null,
      });
      expect(alice.room()!.members).toHaveLength(2);
      carol.send({ type: 'room.join', roomId });
      expect(carol.errorCodes()).toEqual(['banned']);

      vi.advanceTimersByTime(11 * 60 * 1000);
      carol.send({ type: 'room.join', roomId });
      expect(carol.last('room.joined')).toBeDefined();
    });

    it('stops a cohost from kicking the host or another cohost', () => {
      const { alice, bob, carol } = setupTrio();
      alice.send({
        type: 'member.setRole',
        userId: bob.userId,
        role: 'cohost',
      });
      alice.send({
        type: 'member.setRole',
        userId: carol.userId,
        role: 'cohost',
      });

      bob.send({ type: 'member.kick', userId: alice.userId });
      bob.send({ type: 'member.kick', userId: carol.userId });

      expect(bob.errorCodes()).toEqual(['forbidden', 'forbidden']);
    });

    it('prevents muted members from chatting, queueing and voting', () => {
      const { alice, bob } = setupTrio();
      alice.send({ type: 'queue.add', track: track('1') });
      alice.send({ type: 'queue.add', track: track('2') });
      const queuedId = alice.room()!.queue[0].id;
      alice.send({ type: 'member.mute', userId: bob.userId, muted: true });

      bob.send({ type: 'chat.send', text: 'hi' });
      bob.send({ type: 'queue.add', track: track('3') });
      bob.send({ type: 'queue.vote', itemId: queuedId });

      expect(bob.errorCodes()).toEqual(['muted', 'muted', 'muted']);

      alice.send({ type: 'member.mute', userId: bob.userId, muted: false });
      bob.send({ type: 'chat.send', text: 'hi again' });
      expect(bob.errorCodes()).toHaveLength(3);
    });
  });

  describe('session recap', () => {
    it('summarises most added, most skipped and the top contributor', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      const bob = harness.connect('bob');
      const roomId = createRoom(alice);
      bob.send({ type: 'room.join', roomId });

      bob.send({ type: 'queue.add', track: track('1') });
      bob.send({ type: 'queue.add', track: track('2') });
      alice.send({ type: 'queue.add', track: track('3') });
      alice.send({ type: 'playback.skip' });
      alice.send({ type: 'playback.ended', itemId: alice.room()!.current!.id });
      bob.send({ type: 'queue.add', track: track('1') });
      alice.send({ type: 'playback.skip' });
      alice.clear();

      alice.send({ type: 'room.recap' });

      const { recap } = alice.last('room.recap')!;
      expect(recap.roomName).toBe('Late Night');
      expect(recap.tracksPlayed).toBe(3);
      expect(recap.topContributor).toEqual({
        userId: bob.userId,
        displayName: 'bob',
        added: 3,
      });
      expect(recap.mostAdded[0]).toMatchObject({ count: 2 });
      expect(recap.mostAdded[0].track.title).toBe('Song 1');
      expect(recap.mostSkipped.map((entry) => entry.track.title)).toEqual([
        'Song 1',
        'Song 3',
      ]);
      expect(
        recap.history.map((entry) => [entry.track.title, entry.skipped]),
      ).toEqual([
        ['Song 1', true],
        ['Song 2', false],
        ['Song 3', true],
      ]);
    });
  });

  describe('profile', () => {
    it('updates the display name and genres shown to the room', () => {
      const harness = createHarness();
      const alice = harness.connect('alice');
      createRoom(alice);

      alice.send({
        type: 'profile.update',
        displayName: 'Alicia',
        genres: ['Jazz', ' jazz ', 'Blues'],
      });

      const member = alice.room()!.members[0];
      expect(member.displayName).toBe('Alicia');
      expect(member.genres).toEqual(['jazz', 'blues']);
    });
  });
});
