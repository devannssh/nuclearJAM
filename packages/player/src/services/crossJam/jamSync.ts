import type {
  JamQueueItem,
  JamRoomState,
  QueueItem,
} from '@nuclearplayer/model';
import { jamExpectedPositionMs } from '@nuclearplayer/model';

import { useCrossJamStore } from '../../stores/crossJamStore';
import { useQueueStore } from '../../stores/queueStore';
import { useSoundStore } from '../../stores/soundStore';
import { eventBus } from '../eventBus';
import { streamResolution } from '../streamResolution';
import { jamClient } from './jamClient';
import { setQueueInterceptor } from './queueInterceptor';
import { suppressNextResolutionAutoPlay } from './resolutionGate';
import { fromJamTrack } from './trackMapping';

const DRIFT_THRESHOLD_MS = 1500;
const DRIFT_CHECK_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 5000;
const MIN_START_OFFSET_MS = 2000;

type SavedQueue = { items: QueueItem[]; currentIndex: number };

type AppliedPlayback = JamRoomState['playback'];

export class CrossJamSync {
  private active = false;
  private savedQueue: SavedQueue | null = null;
  private applyingRemote = false;
  private lastCurrentId: string | null = null;
  private lastApplied: AppliedPlayback | null = null;
  private disposers: (() => void)[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];

  start(): void {
    this.disposers.push(
      useCrossJamStore.subscribe((state, previous) =>
        this.onRoomChange(state.room, previous.room),
      ),
      useSoundStore.subscribe((state, previous) => {
        if (state.status !== previous.status) {
          this.onStatusChange(state.status, state.seek);
        }
      }),
      eventBus.on('playbackSeeked', async ({ toMs }) => {
        this.onSeek(toMs);
      }),
    );
    this.intervals.push(
      setInterval(() => this.correctDrift(), DRIFT_CHECK_INTERVAL_MS),
      setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS),
    );
  }

  stop(): void {
    this.disposers.forEach((dispose) => dispose());
    this.intervals.forEach((interval) => clearInterval(interval));
    this.disposers = [];
    this.intervals = [];
    if (this.active) {
      this.exitRoom();
    }
  }

  private onRoomChange(
    room: JamRoomState | null,
    previous: JamRoomState | null,
  ): void {
    if (room === previous) {
      return;
    }
    if (room && !previous) {
      this.enterRoom(room);
      return;
    }
    if (!room && previous) {
      this.exitRoom();
      return;
    }
    if (room) {
      this.applyRoom(room);
    }
  }

  private enterRoom(room: JamRoomState): void {
    const queue = useQueueStore.getState();
    this.savedQueue = { items: queue.items, currentIndex: queue.currentIndex };
    this.active = true;
    this.lastCurrentId = null;
    this.lastApplied = null;
    useSoundStore.getState().stop();

    setQueueInterceptor({
      addTracks: (tracks) =>
        tracks.forEach((track) => useCrossJamStore.getState().addTrack(track)),
      skip: () => useCrossJamStore.getState().skip(),
      removeItems: (itemIds) =>
        itemIds.forEach((itemId) =>
          useCrossJamStore.getState().removeQueueItem(itemId),
        ),
      trackEnded: (itemId) => {
        if (this.isController()) {
          useCrossJamStore.getState().reportEnded(itemId);
        }
      },
    });
    this.applyRoom(room);
  }

  private exitRoom(): void {
    setQueueInterceptor(null);
    this.active = false;
    useSoundStore.getState().stop();

    const saved = this.savedQueue;
    this.savedQueue = null;
    if (saved) {
      suppressNextResolutionAutoPlay();
      useQueueStore
        .getState()
        .replaceItems(saved.items, saved.currentIndex, { persist: true });
    }
  }

  private applyRoom(room: JamRoomState): void {
    const currentId = room.current?.id ?? null;
    const currentChanged = currentId !== this.lastCurrentId;
    const localItems = new Map(
      useQueueStore.getState().items.map((item) => [item.id, item]),
    );

    const toQueueItem = (jamItem: JamQueueItem, isNewCurrent: boolean) => {
      const existing = localItems.get(jamItem.id);
      if (existing) {
        return isNewCurrent
          ? { ...existing, status: 'loading' as const }
          : existing;
      }
      return {
        id: jamItem.id,
        track: fromJamTrack(jamItem.track),
        status: isNewCurrent ? ('loading' as const) : ('idle' as const),
        addedAtIso: new Date(jamItem.addedAt).toISOString(),
      };
    };

    const items = [room.current, ...room.queue].flatMap((jamItem, index) =>
      jamItem ? [toQueueItem(jamItem, index === 0 && currentChanged)] : [],
    );
    useQueueStore.getState().replaceItems(items, 0);

    if (!room.current) {
      this.lastCurrentId = null;
      this.lastApplied = null;
      this.withRemote(() => useSoundStore.getState().stop());
      return;
    }
    if (currentChanged) {
      this.lastCurrentId = currentId;
      this.startCurrent(room);
      return;
    }
    this.applyPlayback(room);
  }

  private startCurrent(room: JamRoomState): void {
    const item = useQueueStore.getState().getCurrentItem();
    if (!item) {
      return;
    }
    this.lastApplied = room.playback;
    const expectedMs = this.expectedPositionMs(room);
    void streamResolution.resolve(item, {
      autoPlay: room.playback.playing,
      startPositionSeconds:
        expectedMs >= MIN_START_OFFSET_MS ? expectedMs / 1000 : undefined,
    });
  }

  private applyPlayback(room: JamRoomState): void {
    const next = room.playback;
    const previous = this.lastApplied;
    if (
      previous &&
      previous.playing === next.playing &&
      previous.positionMs === next.positionMs &&
      previous.updatedAt === next.updatedAt
    ) {
      return;
    }
    this.lastApplied = next;

    const expectedMs = this.expectedPositionMs(room);
    this.withRemote(() => {
      const sound = useSoundStore.getState();
      const startedPlaying = next.playing && !previous?.playing;
      if (startedPlaying && sound.status === 'paused') {
        sound.play();
      }
      if (!next.playing && sound.status === 'playing') {
        sound.pause();
      }
      const isLoaded = sound.status === 'playing' || sound.status === 'paused';
      if (isLoaded && this.driftMs(expectedMs) > DRIFT_THRESHOLD_MS) {
        sound.seekTo(expectedMs / 1000);
      }
    });
  }

  private onStatusChange(status: string, seekSeconds: number): void {
    if (!this.canReportPlayback()) {
      return;
    }
    const room = useCrossJamStore.getState().room;
    if (!room?.current) {
      return;
    }
    if (status === 'playing' || status === 'paused') {
      useCrossJamStore
        .getState()
        .reportPlayback(
          room.current.id,
          status === 'playing',
          seekSeconds * 1000,
        );
    }
  }

  private onSeek(toMs: number): void {
    if (!this.canReportPlayback()) {
      return;
    }
    const room = useCrossJamStore.getState().room;
    if (!room?.current) {
      return;
    }
    const playing = useSoundStore.getState().status === 'playing';
    useCrossJamStore.getState().reportPlayback(room.current.id, playing, toMs);
  }

  private correctDrift(): void {
    const room = useCrossJamStore.getState().room;
    if (!this.active || !room?.playback.playing || this.isController()) {
      return;
    }
    const sound = useSoundStore.getState();
    if (sound.status !== 'playing') {
      return;
    }
    const expectedMs = this.expectedPositionMs(room);
    if (this.driftMs(expectedMs) > DRIFT_THRESHOLD_MS) {
      this.withRemote(() => sound.seekTo(expectedMs / 1000));
    }
  }

  private sendHeartbeat(): void {
    const { room, profile } = useCrossJamStore.getState();
    if (!this.active || !room?.current || room.hostId !== profile?.userId) {
      return;
    }
    const sound = useSoundStore.getState();
    const isLoaded = sound.status === 'playing' || sound.status === 'paused';
    const currentLocalId = useQueueStore.getState().getCurrentItem()?.id;
    if (!isLoaded || currentLocalId !== room.current.id) {
      return;
    }
    useCrossJamStore
      .getState()
      .reportPlayback(
        room.current.id,
        sound.status === 'playing',
        sound.seek * 1000,
      );
  }

  private canReportPlayback(): boolean {
    if (!this.active || this.applyingRemote || !this.isController()) {
      return false;
    }
    const room = useCrossJamStore.getState().room;
    const currentLocalId = useQueueStore.getState().getCurrentItem()?.id;
    return !!room?.current && room.current.id === currentLocalId;
  }

  private isController(): boolean {
    const { room, profile } = useCrossJamStore.getState();
    const role = room?.members.find(
      (member) => member.userId === profile?.userId,
    )?.role;
    return role === 'host' || role === 'cohost';
  }

  private expectedPositionMs(room: JamRoomState): number {
    return jamExpectedPositionMs(room.playback, jamClient.serverNow());
  }

  private driftMs(expectedMs: number): number {
    return Math.abs(useSoundStore.getState().seek * 1000 - expectedMs);
  }

  private withRemote(action: () => void): void {
    this.applyingRemote = true;
    try {
      action();
    } finally {
      this.applyingRemote = false;
    }
  }
}

export const crossJamSync = new CrossJamSync();

export const initCrossJamSync = (): void => {
  crossJamSync.start();
};
