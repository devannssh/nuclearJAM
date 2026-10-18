import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  JamQueueItem,
  JamRoomState,
  JamServerMessage,
} from '@nuclearplayer/model';

import { jamClient } from '../services/crossJam/jamClient';
import { useCrossJamStore } from './crossJamStore';

const queueItem = (id: string): JamQueueItem => ({
  id,
  track: {
    title: `Song ${id}`,
    artists: ['Artist'],
    source: { provider: 'p', id },
  },
  addedBy: 'user-1',
  addedByName: 'Sam',
  addedAt: 1000,
  votes: [],
});

const roomState = (overrides: Partial<JamRoomState> = {}): JamRoomState => ({
  id: 'room-1',
  name: 'Late Night',
  genres: ['house'],
  privacy: 'public',
  capacity: 10,
  skipMode: 'anyone',
  inviteCode: null,
  hostId: 'user-1',
  members: [],
  current: queueItem('a'),
  queue: [],
  playback: { playing: true, positionMs: 0, updatedAt: 1000 },
  skipVotes: [],
  eventId: null,
  createdAt: 0,
  ...overrides,
});

const handle = (message: JamServerMessage) =>
  useCrossJamStore.getState().handleMessage(message);

describe('Cross Jam store', () => {
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useCrossJamStore.setState({
      profile: {
        userId: 'user-1',
        secret: 'secret-1234567890',
        displayName: 'Sam',
        genres: ['house'],
      },
      status: 'connected',
      friendCode: null,
      notice: null,
      rooms: [],
      room: null,
      chat: [],
      reactions: [],
      recap: null,
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      events: [],
      startingEvent: null,
    });
    sendSpy = vi.spyOn(jamClient, 'send').mockReturnValue(true);
  });

  describe('server messages', () => {
    it('refreshes rooms, friends and events after the welcome', () => {
      handle({
        type: 'welcome',
        userId: 'user-1',
        friendCode: 'ABCDEFGH',
        serverTime: 0,
        resumedRoomId: null,
      });

      expect(useCrossJamStore.getState().friendCode).toBe('ABCDEFGH');
      expect(sendSpy.mock.calls.map(([message]) => message.type)).toEqual([
        'rooms.list',
        'friends.list',
        'events.list',
      ]);
    });

    it('forgets a stale room when the server did not resume it', () => {
      useCrossJamStore.setState({ room: roomState() });

      handle({
        type: 'welcome',
        userId: 'user-1',
        friendCode: 'ABCDEFGH',
        serverTime: 0,
        resumedRoomId: null,
      });

      expect(useCrossJamStore.getState().room).toBeNull();
    });

    it('keeps the room when the server resumed it', () => {
      useCrossJamStore.setState({ room: roomState() });

      handle({
        type: 'welcome',
        userId: 'user-1',
        friendCode: 'ABCDEFGH',
        serverTime: 0,
        resumedRoomId: 'room-1',
      });

      expect(useCrossJamStore.getState().room?.id).toBe('room-1');
    });

    it('stores the room and chat history on join', () => {
      handle({
        type: 'room.joined',
        room: roomState(),
        chat: [
          {
            id: 'm1',
            kind: 'user',
            userId: 'u',
            displayName: 'Al',
            text: 'hi',
            at: 1,
          },
        ],
      });

      expect(useCrossJamStore.getState().room?.name).toBe('Late Night');
      expect(useCrossJamStore.getState().chat).toHaveLength(1);
    });

    it('ignores state for a room it is not in', () => {
      handle({ type: 'room.state', room: roomState() });

      expect(useCrossJamStore.getState().room).toBeNull();
    });

    it('merges playback updates only for the current track', () => {
      useCrossJamStore.setState({ room: roomState() });

      handle({
        type: 'playback.state',
        currentId: 'a',
        playback: { playing: false, positionMs: 5000, updatedAt: 2000 },
        skipVotes: ['user-2'],
      });
      expect(useCrossJamStore.getState().room?.playback.positionMs).toBe(5000);
      expect(useCrossJamStore.getState().room?.skipVotes).toEqual(['user-2']);

      handle({
        type: 'playback.state',
        currentId: 'other',
        playback: { playing: true, positionMs: 9, updatedAt: 3000 },
        skipVotes: [],
      });
      expect(useCrossJamStore.getState().room?.playback.positionMs).toBe(5000);
    });

    it('clears the room and keeps the recap when leaving', () => {
      useCrossJamStore.setState({ room: roomState(), chat: [] });
      const recap = {
        roomName: 'Late Night',
        durationMs: 1,
        tracksPlayed: 0,
        mostAdded: [],
        mostSkipped: [],
        topContributor: null,
        history: [],
      };

      handle({ type: 'room.left', reason: 'left', recap });

      expect(useCrossJamStore.getState().room).toBeNull();
      expect(useCrossJamStore.getState().recap).toEqual(recap);
    });

    it('raises a notice when kicked', () => {
      useCrossJamStore.setState({ room: roomState() });

      handle({ type: 'room.left', reason: 'kicked', recap: null });

      expect(useCrossJamStore.getState().notice?.code).toBe('kicked');
    });

    it('turns server errors into notices', () => {
      handle({ type: 'error', code: 'room_full', message: 'x' });

      expect(useCrossJamStore.getState().notice?.code).toBe('room_full');
    });

    it('keeps only the most recent chat messages', () => {
      for (let index = 0; index < 250; index += 1) {
        handle({
          type: 'chat.message',
          message: {
            id: `m${index}`,
            kind: 'user',
            userId: 'u',
            displayName: 'Al',
            text: `${index}`,
            at: index,
          },
        });
      }

      const { chat } = useCrossJamStore.getState();
      expect(chat).toHaveLength(200);
      expect(chat[chat.length - 1].text).toBe('249');
    });

    it('shows reactions briefly', () => {
      vi.useFakeTimers();

      handle({ type: 'reaction', userId: 'u', displayName: 'Al', emoji: '🔥' });
      expect(useCrossJamStore.getState().reactions).toHaveLength(1);

      vi.advanceTimersByTime(3100);
      expect(useCrossJamStore.getState().reactions).toHaveLength(0);
      vi.useRealTimers();
    });
  });

  describe('actions', () => {
    it.each([
      [
        'createRoom',
        () =>
          useCrossJamStore.getState().createRoom({
            name: 'x',
            genres: [],
            privacy: 'public',
            capacity: 5,
            skipMode: 'anyone',
          }),
        'room.create',
      ],
      [
        'joinRoom',
        () => useCrossJamStore.getState().joinRoom({ roomId: 'r' }),
        'room.join',
      ],
      [
        'leaveRoom',
        () => useCrossJamStore.getState().leaveRoom(),
        'room.leave',
      ],
      [
        'voteQueueItem',
        () => useCrossJamStore.getState().voteQueueItem('i'),
        'queue.vote',
      ],
      ['skip', () => useCrossJamStore.getState().skip(), 'playback.skip'],
      [
        'sendChat',
        () => useCrossJamStore.getState().sendChat('hi'),
        'chat.send',
      ],
      ['react', () => useCrossJamStore.getState().react('🔥'), 'reaction.send'],
      ['kick', () => useCrossJamStore.getState().kick('u'), 'member.kick'],
      [
        'requestFriend',
        () => useCrossJamStore.getState().requestFriend('CODE'),
        'friends.request',
      ],
      [
        'rsvp',
        () => useCrossJamStore.getState().rsvp('e', true),
        'events.rsvp',
      ],
    ])('%s sends the matching protocol message', (_name, run, type) => {
      run();

      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ type }));
    });

    it('sends only the compact track details when adding a song', () => {
      useCrossJamStore.getState().addTrack({
        title: 'Song',
        artists: [{ name: 'Artist', roles: [] }],
        durationMs: 1000,
        source: { provider: 'p', id: 'i' },
        streamCandidates: [
          {
            id: 's',
            title: 'x',
            failed: false,
            source: { provider: 'y', id: 's' },
          },
        ],
      });

      expect(sendSpy).toHaveBeenCalledWith({
        type: 'queue.add',
        track: {
          title: 'Song',
          artists: ['Artist'],
          album: undefined,
          durationMs: 1000,
          artworkUrl: undefined,
          source: { provider: 'p', id: 'i' },
        },
      });
    });
  });
});
