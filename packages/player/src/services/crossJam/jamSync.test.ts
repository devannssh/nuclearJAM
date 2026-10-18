import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  JamQueueItem,
  JamRole,
  JamRoomState,
  QueueItem,
  Track,
} from '@nuclearplayer/model';

import { useCrossJamStore } from '../../stores/crossJamStore';
import { useQueueStore } from '../../stores/queueStore';
import { useSoundStore } from '../../stores/soundStore';
import { streamResolution } from '../streamResolution';
import { jamClient } from './jamClient';
import { CrossJamSync } from './jamSync';
import { getQueueInterceptor } from './queueInterceptor';
import { consumeSuppressedAutoPlay } from './resolutionGate';

vi.mock('../streamResolution', () => ({
  streamResolution: { resolve: vi.fn().mockResolvedValue(undefined) },
}));

const ME = 'user-me';

const jamItem = (id: string): JamQueueItem => ({
  id,
  track: {
    title: `Song ${id}`,
    artists: ['Artist'],
    source: { provider: 'p', id },
  },
  addedBy: 'user-other',
  addedByName: 'Al',
  addedAt: 1000,
  votes: [],
});

const buildRoom = (
  role: JamRole,
  overrides: Partial<JamRoomState> = {},
): JamRoomState => ({
  id: 'room-1',
  name: 'Late Night',
  genres: ['house'],
  privacy: 'public',
  capacity: 10,
  skipMode: 'anyone',
  inviteCode: null,
  hostId: role === 'host' ? ME : 'user-other',
  members: [
    {
      userId: ME,
      displayName: 'Me',
      genres: [],
      role,
      muted: false,
      connected: true,
      joinedAt: 0,
    },
  ],
  current: jamItem('a'),
  queue: [jamItem('b')],
  playback: { playing: true, positionMs: 0, updatedAt: Date.now() },
  skipVotes: [],
  eventId: null,
  createdAt: 0,
  ...overrides,
});

const localTrack = (title: string): Track => ({
  title,
  artists: [{ name: 'Local', roles: [] }],
  source: { provider: 'p', id: title },
});

const localItem = (id: string): QueueItem => ({
  id,
  track: localTrack(id),
  status: 'idle',
  addedAtIso: '2026-01-01T00:00:00.000Z',
});

const resolveMock = vi.mocked(streamResolution.resolve);

describe('Cross Jam sync', () => {
  let sync: CrossJamSync;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  const joinAs = (role: JamRole, overrides: Partial<JamRoomState> = {}) => {
    useCrossJamStore.setState({ room: buildRoom(role, overrides) });
  };

  const updateRoom = (changes: Partial<JamRoomState>) => {
    const room = useCrossJamStore.getState().room!;
    useCrossJamStore.setState({ room: { ...room, ...changes } });
  };

  const sentTypes = () => sendSpy.mock.calls.map(([message]) => message.type);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    resolveMock.mockClear();
    useSoundStore.setState({ status: 'stopped', seek: 0, duration: 0 });
    useQueueStore.setState({
      items: [localItem('mine-1'), localItem('mine-2')],
      currentIndex: 1,
    });
    useCrossJamStore.setState({
      profile: {
        userId: ME,
        secret: 'secret-1234567890',
        displayName: 'Me',
        genres: [],
      },
      room: null,
    });
    vi.spyOn(jamClient, 'serverNow').mockImplementation(() => Date.now());
    sendSpy = vi.spyOn(jamClient, 'send').mockReturnValue(true);
    sync = new CrossJamSync();
    sync.start();
  });

  afterEach(() => {
    sync.stop();
    consumeSuppressedAutoPlay();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('entering and leaving a room', () => {
    it("replaces the local queue with the room's queue", () => {
      joinAs('member');

      const { items, currentIndex } = useQueueStore.getState();
      expect(items.map((item) => item.id)).toEqual(['a', 'b']);
      expect(currentIndex).toBe(0);
      expect(items[0].track.title).toBe('Song a');
    });

    it('starts the current track and autoplays it when the room is playing', () => {
      joinAs('member');

      expect(resolveMock).toHaveBeenCalledTimes(1);
      expect(resolveMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
        { autoPlay: true, startPositionSeconds: undefined },
      );
    });

    it('starts late joiners at the room position', () => {
      joinAs('member', {
        playback: {
          playing: true,
          positionMs: 60_000,
          updatedAt: Date.now() - 5000,
        },
      });

      expect(resolveMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
        { autoPlay: true, startPositionSeconds: 65 },
      );
    });

    it('loads the track without playing when the room is paused', () => {
      joinAs('member', {
        playback: { playing: false, positionMs: 0, updatedAt: Date.now() },
      });

      expect(resolveMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
        expect.objectContaining({ autoPlay: false }),
      );
    });

    it('stops anything already playing locally when joining', () => {
      useSoundStore.setState({ status: 'playing', seek: 42 });

      joinAs('member');

      expect(useSoundStore.getState().status).toBe('stopped');
    });

    it('restores the original queue and normal behaviour on leaving', () => {
      joinAs('member');

      useCrossJamStore.setState({ room: null });

      const { items, currentIndex } = useQueueStore.getState();
      expect(items.map((item) => item.id)).toEqual(['mine-1', 'mine-2']);
      expect(currentIndex).toBe(1);
      expect(getQueueInterceptor()).toBeNull();
      expect(useSoundStore.getState().status).toBe('stopped');
    });

    it('prevents the restored queue from autoplaying on its own', () => {
      joinAs('member');

      useCrossJamStore.setState({ room: null });

      expect(consumeSuppressedAutoPlay()).toBe(true);
    });
  });

  describe('queue actions inside a room', () => {
    it('sends added tracks to the room instead of the local queue', () => {
      joinAs('member');

      useQueueStore.getState().addToQueue([localTrack('New song')]);

      expect(sentTypes()).toContain('queue.add');
      expect(useQueueStore.getState().items.map((item) => item.id)).toEqual([
        'a',
        'b',
      ]);
    });

    it('turns next into a skip request', () => {
      joinAs('member');

      useQueueStore.getState().goToNext();

      expect(sendSpy).toHaveBeenCalledWith({ type: 'playback.skip' });
    });

    it('turns queue removal into a room removal', () => {
      joinAs('member');

      useQueueStore.getState().removeByIds(['b']);

      expect(sendSpy).toHaveBeenCalledWith({
        type: 'queue.remove',
        itemId: 'b',
      });
    });

    it('ignores local reordering, clearing and jumping', () => {
      joinAs('member');
      const before = useQueueStore.getState().items;

      useQueueStore.getState().reorder(0, 1);
      useQueueStore.getState().clearQueue();
      useQueueStore.getState().goToIndex(1);
      useQueueStore.getState().goToPrevious();

      expect(useQueueStore.getState().items).toEqual(before);
      expect(useQueueStore.getState().currentIndex).toBe(0);
    });
  });

  describe('following the room', () => {
    it('starts the next track when the room moves on', () => {
      joinAs('member');
      resolveMock.mockClear();

      updateRoom({
        current: jamItem('b'),
        queue: [],
        playback: { playing: true, positionMs: 0, updatedAt: Date.now() },
      });

      expect(resolveMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b' }),
        expect.objectContaining({ autoPlay: true }),
      );
      expect(useQueueStore.getState().items.map((item) => item.id)).toEqual([
        'b',
      ]);
    });

    it('keeps already-resolved queue items when the queue changes', () => {
      joinAs('member');
      useQueueStore.getState().updateItemState('b', { status: 'success' });

      updateRoom({ queue: [jamItem('c'), jamItem('b')] });

      const items = useQueueStore.getState().items;
      expect(items.map((item) => item.id)).toEqual(['a', 'c', 'b']);
      expect(items[2].status).toBe('success');
    });

    it('does not re-resolve the current track when only the queue changes', () => {
      joinAs('member');
      resolveMock.mockClear();

      updateRoom({ queue: [jamItem('b'), jamItem('c')] });

      expect(resolveMock).not.toHaveBeenCalled();
    });

    it('stops playing when the room runs out of songs', () => {
      joinAs('member');
      useSoundStore.setState({ status: 'playing' });

      updateRoom({
        current: null,
        queue: [],
        playback: { playing: false, positionMs: 0, updatedAt: Date.now() },
      });

      expect(useSoundStore.getState().status).toBe('stopped');
      expect(useQueueStore.getState().items).toEqual([]);
    });

    it('pauses when the host pauses', () => {
      joinAs('member');
      useSoundStore.setState({ status: 'playing', seek: 5 });

      updateRoom({
        playback: { playing: false, positionMs: 5000, updatedAt: Date.now() },
      });

      expect(useSoundStore.getState().status).toBe('paused');
    });

    it('resumes when the host resumes', () => {
      joinAs('member', {
        playback: { playing: false, positionMs: 5000, updatedAt: Date.now() },
      });
      useSoundStore.setState({ status: 'paused', seek: 5 });

      updateRoom({
        playback: { playing: true, positionMs: 5000, updatedAt: Date.now() },
      });

      expect(useSoundStore.getState().status).toBe('playing');
    });

    it('lets a listener stay paused through routine host updates', () => {
      joinAs('member');
      useSoundStore.setState({ status: 'paused', seek: 0 });

      updateRoom({
        playback: { playing: true, positionMs: 0, updatedAt: Date.now() },
      });

      expect(useSoundStore.getState().status).toBe('paused');
    });

    it('jumps to the new position when the host seeks', () => {
      joinAs('member');
      useSoundStore.setState({ status: 'playing', seek: 1 });

      updateRoom({
        playback: { playing: true, positionMs: 60_000, updatedAt: Date.now() },
      });

      expect(useSoundStore.getState().seek).toBe(60);
    });

    it('does not seek while the track is still loading', () => {
      joinAs('member');
      useSoundStore.setState({ status: 'stopped', seek: 0 });

      updateRoom({
        playback: { playing: true, positionMs: 60_000, updatedAt: Date.now() },
      });

      expect(useSoundStore.getState().seek).toBe(0);
    });
  });

  describe('drift correction', () => {
    it('pulls a listener back in line once they drift too far', () => {
      joinAs('member');
      useSoundStore.setState({ status: 'playing', seek: 0 });

      vi.advanceTimersByTime(2000);

      expect(useSoundStore.getState().seek).toBe(2);
    });

    it('leaves small drift alone', () => {
      joinAs('member', {
        playback: { playing: true, positionMs: 1000, updatedAt: Date.now() },
      });
      useSoundStore.setState({ status: 'playing', seek: 0.5 });

      vi.advanceTimersByTime(1000);

      expect(useSoundStore.getState().seek).toBe(0.5);
    });

    it('does not correct a paused listener', () => {
      joinAs('member');
      useSoundStore.setState({ status: 'paused', seek: 0 });

      vi.advanceTimersByTime(4000);

      expect(useSoundStore.getState().seek).toBe(0);
    });

    it('never drags the host, who is the clock', () => {
      joinAs('host');
      useSoundStore.setState({ status: 'playing', seek: 0 });

      vi.advanceTimersByTime(2000);

      expect(useSoundStore.getState().seek).toBe(0);
    });
  });

  describe('the host driving the room clock', () => {
    it('reports pausing and resuming', () => {
      joinAs('host');
      useSoundStore.setState({ status: 'playing', seek: 12 });
      sendSpy.mockClear();

      useSoundStore.getState().pause();

      expect(sendSpy).toHaveBeenCalledWith({
        type: 'playback.update',
        itemId: 'a',
        playing: false,
        positionMs: 12_000,
      });

      useSoundStore.getState().play();
      expect(sendSpy).toHaveBeenLastCalledWith({
        type: 'playback.update',
        itemId: 'a',
        playing: true,
        positionMs: 12_000,
      });
    });

    it('lets a co-host control playback too', () => {
      joinAs('cohost');
      useSoundStore.setState({ status: 'playing', seek: 3 });
      sendSpy.mockClear();

      useSoundStore.getState().pause();

      expect(sentTypes()).toEqual(['playback.update']);
    });

    it('does not let a regular listener change the room by pausing', () => {
      joinAs('member');
      useSoundStore.setState({ status: 'playing', seek: 3 });
      sendSpy.mockClear();

      useSoundStore.getState().pause();

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('reports a seek', () => {
      joinAs('host');
      useSoundStore.setState({ status: 'playing', seek: 3 });
      sendSpy.mockClear();

      useSoundStore.getState().seekTo(30);

      expect(sendSpy).toHaveBeenCalledWith({
        type: 'playback.update',
        itemId: 'a',
        playing: true,
        positionMs: 30_000,
      });
    });

    it('does not report seeks made by listeners', () => {
      joinAs('member');
      useSoundStore.setState({ status: 'playing', seek: 3 });
      sendSpy.mockClear();

      useSoundStore.getState().seekTo(30);

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('sends a heartbeat every few seconds while playing', () => {
      joinAs('host');
      useSoundStore.setState({ status: 'playing', seek: 12 });
      sendSpy.mockClear();

      vi.advanceTimersByTime(5000);

      expect(sendSpy).toHaveBeenCalledWith({
        type: 'playback.update',
        itemId: 'a',
        playing: true,
        positionMs: 12_000,
      });
    });

    it('stays quiet while its own track is still loading', () => {
      joinAs('host');
      useSoundStore.setState({ status: 'stopped', seek: 0 });
      sendSpy.mockClear();

      vi.advanceTimersByTime(10_000);

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('does not echo changes that came from the room itself', () => {
      joinAs('host');
      useSoundStore.setState({ status: 'playing', seek: 5 });
      sendSpy.mockClear();

      updateRoom({
        playback: { playing: false, positionMs: 5000, updatedAt: Date.now() },
      });

      expect(useSoundStore.getState().status).toBe('paused');
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('reports when its track finishes', () => {
      joinAs('host');

      getQueueInterceptor()!.trackEnded('a');

      expect(sendSpy).toHaveBeenCalledWith({
        type: 'playback.ended',
        itemId: 'a',
      });
    });

    it('lets listeners wait for the room when their track finishes', () => {
      joinAs('member');

      getQueueInterceptor()!.trackEnded('a');

      expect(sendSpy).not.toHaveBeenCalled();
    });
  });
});
