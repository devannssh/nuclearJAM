import {
  computeTasteMatch,
  JAM_EMPTY_ROOM_TTL_MS,
  JAM_KICK_BAN_MS,
  JAM_LIMITS,
  JAM_RESUME_GRACE_MS,
  jamClientMessageSchema,
  jamExpectedPositionMs,
  jamSkipThreshold,
  jamTrackKey,
} from '@nuclearplayer/model';
import type {
  JamChatMessage,
  JamClientMessage,
  JamErrorCode,
  JamEvent,
  JamHistoryEntry,
  JamMember,
  JamPlayback,
  JamQueueItem,
  JamRecap,
  JamRecapTrackCount,
  JamRoomSettings,
  JamRoomState,
  JamRoomSummary,
  JamServerMessage,
  JamTrack,
} from '@nuclearplayer/model';

import { hashSecret, newCode, newId, secretsMatch } from './ids';
import { SlidingWindowLimiter, TokenBucket } from './rateLimiter';
import { SocialService } from './social';
import type { Connection, PersistedData, Persistence } from './types';

const ADVANCE_GRACE_MS = 8000;
const CHAT_HISTORY_LIMIT = 100;
const CHAT_ON_JOIN = 50;
const PLAYED_HISTORY_LIMIT = 500;
const MESSAGE_BUCKET_CAPACITY = 40;
const MESSAGE_REFILL_PER_SECOND = 5;
const INVITE_CODE_LENGTH = 6;
const FRIEND_CODE_LENGTH = 8;

type Session = {
  id: string;
  connection: Connection;
  userId: string | null;
  bucket: TokenBucket;
};

type Room = {
  id: string;
  settings: JamRoomSettings;
  inviteCode: string | null;
  hostId: string | null;
  members: Map<string, JamMember>;
  queue: JamQueueItem[];
  current: JamQueueItem | null;
  playback: JamPlayback;
  skipVotes: Set<string>;
  chat: JamChatMessage[];
  history: JamHistoryEntry[];
  eventId: string | null;
  createdAt: number;
  bans: Map<string, number>;
  order: Map<string, number>;
  orderCounter: number;
  emptyTimer: NodeJS.Timeout | null;
  advanceTimer: NodeJS.Timeout | null;
  adds: Map<string, JamRecapTrackCount>;
  skips: Map<string, JamRecapTrackCount>;
  contributions: Map<string, { displayName: string; count: number }>;
};

export type JamServerOptions = {
  persistence: Persistence;
  now?: () => number;
};

const isModerator = (member: JamMember): boolean =>
  member.role === 'host' || member.role === 'cohost';

const bump = (
  counts: Map<string, JamRecapTrackCount>,
  track: JamTrack,
): void => {
  const key = jamTrackKey(track);
  const existing = counts.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  counts.set(key, { track, count: 1 });
};

const topCounts = (
  counts: Map<string, JamRecapTrackCount>,
): JamRecapTrackCount[] =>
  [...counts.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.track.title.localeCompare(right.track.title),
    )
    .slice(0, 5);

export class JamServer {
  private readonly now: () => number;
  private readonly data: PersistedData;
  private readonly persistence: Persistence;
  private readonly sessions = new Map<string, Session>();
  private readonly sessionsByUser = new Map<string, Session>();
  private readonly rooms = new Map<string, Room>();
  private readonly roomOfUser = new Map<string, string>();
  private readonly resumeTimers = new Map<string, NodeJS.Timeout>();
  private readonly chatLimiter = new SlidingWindowLimiter(5, 5000);
  private readonly reactionLimiter = new SlidingWindowLimiter(6, 3000);
  private readonly social: SocialService;

  constructor(options: JamServerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.persistence = options.persistence;
    this.data = options.persistence.load();
    this.social = new SocialService({
      now: this.now,
      data: this.data,
      persist: () => this.persist(),
      sendTo: (userId, message) => this.sendToUser(userId, message),
      presenceOf: (userId) => this.presenceOf(userId),
      displayNameOf: (userId) => this.data.users[userId]?.displayName ?? null,
      userIdByFriendCode: (code) => this.userIdByFriendCode(code),
      openEventRoom: (userId, event) => this.openEventRoom(userId, event),
      isRoomAlive: (roomId) => this.rooms.has(roomId),
    });
  }

  connect(connection: Connection): string {
    const id = newId();
    this.sessions.set(id, {
      id,
      connection,
      userId: null,
      bucket: new TokenBucket(
        MESSAGE_BUCKET_CAPACITY,
        MESSAGE_REFILL_PER_SECOND,
        this.now(),
      ),
    });
    return id;
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    const userId = session?.userId;
    if (!session || !userId || this.sessionsByUser.get(userId) !== session) {
      return;
    }

    this.sessionsByUser.delete(userId);
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (room && member) {
      member.connected = false;
      this.broadcastState(room);
      const timer = setTimeout(() => {
        this.resumeTimers.delete(userId);
        this.leaveRoom(userId, 'left');
      }, JAM_RESUME_GRACE_MS);
      timer.unref();
      this.resumeTimers.set(userId, timer);
    }
    this.social.presenceChanged(userId);
  }

  receive(sessionId: string, raw: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (!session.bucket.take(this.now())) {
      this.fail(session, 'rate_limited', 'Too many messages');
      return;
    }

    const parsed = jamClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.fail(session, 'invalid_message', 'Invalid message');
      return;
    }

    const message = parsed.data;
    if (message.type === 'ping') {
      session.connection.send({
        type: 'pong',
        clientTime: message.clientTime,
        serverTime: this.now(),
      });
      return;
    }
    if (message.type === 'hello') {
      this.handleHello(session, message);
      return;
    }
    if (!session.userId) {
      this.fail(session, 'not_identified', 'Send hello first');
      return;
    }

    const code = this.dispatch(session.userId, message);
    if (code) {
      this.fail(session, code, code);
    }
  }

  dispose(): void {
    for (const timer of this.resumeTimers.values()) {
      clearTimeout(timer);
    }
    for (const room of this.rooms.values()) {
      this.clearRoomTimers(room);
    }
    this.social.dispose();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  private dispatch(
    userId: string,
    message: Exclude<JamClientMessage, { type: 'hello' | 'ping' }>,
  ): JamErrorCode | null {
    switch (message.type) {
      case 'profile.update':
        return this.updateProfile(userId, message);
      case 'rooms.list':
        this.sendToUser(userId, {
          type: 'rooms',
          rooms: this.listRooms(userId),
        });
        return null;
      case 'room.create':
        return this.createRoom(userId, message.settings, null);
      case 'room.join':
        return this.joinRoom(userId, message.roomId, message.inviteCode);
      case 'room.leave':
        return this.roomFor(userId)
          ? this.leaveRoom(userId, 'left')
          : 'not_in_room';
      case 'room.recap':
        return this.sendRecap(userId);
      case 'room.updateSettings':
        return this.updateSettings(userId, message.settings);
      case 'queue.add':
        return this.queueAdd(userId, message.track);
      case 'queue.remove':
        return this.queueRemove(userId, message.itemId);
      case 'queue.vote':
        return this.queueVote(userId, message.itemId);
      case 'playback.update':
        return this.playbackUpdate(userId, message);
      case 'playback.skip':
        return this.playbackSkip(userId);
      case 'playback.ended':
        return this.playbackEnded(userId, message.itemId);
      case 'chat.send':
        return this.chatSend(userId, message.text);
      case 'reaction.send':
        return this.reactionSend(userId, message.emoji);
      case 'member.setRole':
        return this.setRole(userId, message.userId, message.role);
      case 'member.kick':
        return this.kick(userId, message.userId);
      case 'member.mute':
        return this.mute(userId, message.userId, message.muted);
      default:
        return this.social.handle(userId, message);
    }
  }

  private handleHello(
    session: Session,
    message: Extract<JamClientMessage, { type: 'hello' }>,
  ): void {
    const { userId } = message;
    const existing = this.data.users[userId];
    if (existing && !secretsMatch(message.secret, existing.secretHash)) {
      this.fail(session, 'bad_credentials', 'Bad credentials');
      session.connection.close();
      return;
    }

    this.data.users[userId] = {
      displayName: message.displayName,
      genres: message.genres,
      friendCode: existing?.friendCode ?? this.uniqueFriendCode(),
      secretHash: existing?.secretHash ?? hashSecret(message.secret),
    };
    this.persist();

    const previous = this.sessionsByUser.get(userId);
    if (previous && previous !== session) {
      previous.userId = null;
      previous.connection.close();
    }
    session.userId = userId;
    this.sessionsByUser.set(userId, session);

    const resumeTimer = this.resumeTimers.get(userId);
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      this.resumeTimers.delete(userId);
    }

    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (member) {
      member.connected = true;
      member.displayName = message.displayName;
      member.genres = message.genres;
    }

    session.connection.send({
      type: 'welcome',
      userId,
      friendCode: this.data.users[userId].friendCode,
      serverTime: this.now(),
      resumedRoomId: room?.id ?? null,
    });
    if (room) {
      this.sendToUser(userId, {
        type: 'room.joined',
        room: this.serialize(room),
        chat: room.chat.slice(-CHAT_ON_JOIN),
      });
      this.broadcastState(room, userId);
    }
    this.social.presenceChanged(userId);
  }

  private updateProfile(
    userId: string,
    message: Extract<JamClientMessage, { type: 'profile.update' }>,
  ): JamErrorCode | null {
    const user = this.data.users[userId];
    if (message.displayName !== undefined) {
      user.displayName = message.displayName;
    }
    if (message.genres !== undefined) {
      user.genres = message.genres;
    }
    this.persist();

    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (room && member) {
      member.displayName = user.displayName;
      member.genres = user.genres;
      this.broadcastState(room);
    }
    return null;
  }

  private createRoom(
    userId: string,
    settings: JamRoomSettings,
    eventId: string | null,
  ): JamErrorCode | null {
    if (this.roomOfUser.has(userId)) {
      return 'already_in_room';
    }
    if (this.isNameTaken(settings.name)) {
      return 'name_taken';
    }

    const createdAt = this.now();
    const room: Room = {
      id: newId(),
      settings,
      inviteCode:
        settings.privacy === 'invite' ? newCode(INVITE_CODE_LENGTH) : null,
      hostId: userId,
      members: new Map(),
      queue: [],
      current: null,
      playback: { playing: false, positionMs: 0, updatedAt: createdAt },
      skipVotes: new Set(),
      chat: [],
      history: [],
      eventId,
      createdAt,
      bans: new Map(),
      order: new Map(),
      orderCounter: 0,
      emptyTimer: null,
      advanceTimer: null,
      adds: new Map(),
      skips: new Map(),
      contributions: new Map(),
    };
    this.rooms.set(room.id, room);
    this.addMember(room, userId, 'host');
    this.sendJoined(room, userId);
    this.social.presenceChanged(userId);
    return null;
  }

  private joinRoom(
    userId: string,
    roomId: string | undefined,
    inviteCode: string | undefined,
  ): JamErrorCode | null {
    if (this.roomOfUser.has(userId)) {
      return 'already_in_room';
    }

    const normalizedCode = inviteCode?.toUpperCase();
    const room = normalizedCode
      ? [...this.rooms.values()].find(
          (candidate) => candidate.inviteCode === normalizedCode,
        )
      : roomId
        ? this.rooms.get(roomId)
        : undefined;
    if (!room) {
      return 'room_not_found';
    }
    if (room.settings.privacy === 'invite' && !normalizedCode) {
      return 'invite_required';
    }

    const banExpiry = room.bans.get(userId);
    if (banExpiry !== undefined && banExpiry > this.now()) {
      return 'banned';
    }
    if (room.members.size >= room.settings.capacity) {
      return 'room_full';
    }

    const role = room.members.size === 0 ? 'host' : 'member';
    this.addMember(room, userId, role);
    this.sendJoined(room, userId);
    this.broadcastState(room, userId);
    this.social.presenceChanged(userId);
    return null;
  }

  private addMember(room: Room, userId: string, role: JamMember['role']): void {
    const user = this.data.users[userId];
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    if (role === 'host') {
      room.hostId = userId;
    }
    room.members.set(userId, {
      userId,
      displayName: user.displayName,
      genres: user.genres,
      role,
      muted: false,
      connected: true,
      joinedAt: this.now(),
    });
    this.roomOfUser.set(userId, room.id);
    this.addSystemMessage(room, 'joined', userId, user.displayName, userId);
  }

  private sendJoined(room: Room, userId: string): void {
    this.sendToUser(userId, {
      type: 'room.joined',
      room: this.serialize(room),
      chat: room.chat.slice(-CHAT_ON_JOIN),
    });
  }

  private leaveRoom(
    userId: string,
    reason: 'left' | 'kicked',
  ): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }

    const resumeTimer = this.resumeTimers.get(userId);
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      this.resumeTimers.delete(userId);
    }
    const wasHost = room.hostId === userId;
    room.members.delete(userId);
    room.skipVotes.delete(userId);
    this.roomOfUser.delete(userId);
    this.chatLimiter.forget(userId);
    this.reactionLimiter.forget(userId);

    this.sendToUser(userId, {
      type: 'room.left',
      reason,
      recap: reason === 'left' ? this.buildRecap(room) : null,
    });

    if (room.members.size === 0) {
      this.emptyRoom(room);
    } else {
      if (wasHost) {
        this.promoteHost(room);
      }
      this.addSystemMessage(
        room,
        reason === 'kicked' ? 'kicked' : 'left',
        userId,
        member.displayName,
      );
      this.checkSkipVotes(room);
      this.broadcastState(room);
    }
    this.social.presenceChanged(userId);
    return null;
  }

  private emptyRoom(room: Room): void {
    room.hostId = null;
    if (room.advanceTimer) {
      clearTimeout(room.advanceTimer);
      room.advanceTimer = null;
    }
    room.playback = {
      playing: false,
      positionMs: this.positionNow(room),
      updatedAt: this.now(),
    };
    room.emptyTimer = setTimeout(
      () => this.closeRoom(room),
      JAM_EMPTY_ROOM_TTL_MS,
    );
    room.emptyTimer.unref();
  }

  private closeRoom(room: Room): void {
    this.clearRoomTimers(room);
    this.rooms.delete(room.id);
    this.social.roomClosed(room.id);
  }

  private clearRoomTimers(room: Room): void {
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }
    if (room.advanceTimer) {
      clearTimeout(room.advanceTimer);
      room.advanceTimer = null;
    }
  }

  private promoteHost(room: Room): void {
    const candidates = [...room.members.values()].sort(
      (left, right) => left.joinedAt - right.joinedAt,
    );
    const next =
      candidates.find(
        (member) => member.connected && member.role === 'cohost',
      ) ??
      candidates.find((member) => member.connected) ??
      candidates[0];
    next.role = 'host';
    room.hostId = next.userId;
    this.addSystemMessage(room, 'host_changed', next.userId, next.displayName);
  }

  private updateSettings(
    userId: string,
    changes: Partial<JamRoomSettings>,
  ): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    if (member.role !== 'host') {
      return 'forbidden';
    }
    if (
      changes.name !== undefined &&
      changes.name.toLowerCase() !== room.settings.name.toLowerCase() &&
      this.isNameTaken(changes.name)
    ) {
      return 'name_taken';
    }
    if (
      changes.capacity !== undefined &&
      changes.capacity < room.members.size
    ) {
      return 'member_limit';
    }

    room.settings = { ...room.settings, ...changes };
    if (room.settings.privacy === 'invite' && !room.inviteCode) {
      room.inviteCode = newCode(INVITE_CODE_LENGTH);
    }
    if (room.settings.privacy === 'public') {
      room.inviteCode = null;
    }
    this.checkSkipVotes(room);
    this.broadcastState(room);
    return null;
  }

  private queueAdd(userId: string, track: JamTrack): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    if (member.muted) {
      return 'muted';
    }

    const key = jamTrackKey(track);
    const alreadyQueued = [room.current, ...room.queue].some(
      (item) => item && jamTrackKey(item.track) === key,
    );
    if (alreadyQueued) {
      return 'duplicate_track';
    }
    if (room.queue.length >= JAM_LIMITS.queueMax) {
      return 'queue_full';
    }
    const queuedByMember = room.queue.filter(
      (item) => item.addedBy === userId,
    ).length;
    if (!isModerator(member) && queuedByMember >= JAM_LIMITS.queuedPerMember) {
      return 'member_limit';
    }

    const item: JamQueueItem = {
      id: newId(),
      track,
      addedBy: userId,
      addedByName: member.displayName,
      addedAt: this.now(),
      votes: [],
    };
    room.orderCounter += 1;
    room.order.set(item.id, room.orderCounter);
    bump(room.adds, track);
    const contribution = room.contributions.get(userId);
    room.contributions.set(userId, {
      displayName: member.displayName,
      count: (contribution?.count ?? 0) + 1,
    });

    if (room.current) {
      room.queue.push(item);
      this.sortQueue(room);
    } else {
      this.startItem(room, item);
    }
    this.broadcastState(room);
    return null;
  }

  private queueRemove(userId: string, itemId: string): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    const item = room.queue.find((candidate) => candidate.id === itemId);
    if (!item) {
      return 'item_not_found';
    }
    if (item.addedBy !== userId && !isModerator(member)) {
      return 'forbidden';
    }

    room.queue = room.queue.filter((candidate) => candidate.id !== itemId);
    room.order.delete(itemId);
    this.broadcastState(room);
    return null;
  }

  private queueVote(userId: string, itemId: string): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    if (member.muted) {
      return 'muted';
    }
    const item = room.queue.find((candidate) => candidate.id === itemId);
    if (!item) {
      return 'item_not_found';
    }

    item.votes = item.votes.includes(userId)
      ? item.votes.filter((voter) => voter !== userId)
      : [...item.votes, userId];
    this.sortQueue(room);
    this.broadcastState(room);
    return null;
  }

  private playbackUpdate(
    userId: string,
    message: Extract<JamClientMessage, { type: 'playback.update' }>,
  ): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    if (!isModerator(member)) {
      return 'forbidden';
    }
    if (room.current?.id !== message.itemId) {
      return null;
    }

    this.setPlayback(room, message.playing, message.positionMs);
    this.broadcastPlayback(room);
    return null;
  }

  private playbackEnded(userId: string, itemId: string): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    if (!isModerator(member)) {
      return 'forbidden';
    }
    if (room.current?.id !== itemId) {
      return null;
    }

    this.advance(room, false);
    return null;
  }

  private playbackSkip(userId: string): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    if (!room.current) {
      return null;
    }
    if (isModerator(member)) {
      this.advance(room, true);
      return null;
    }
    if (member.muted) {
      return 'muted';
    }

    switch (room.settings.skipMode) {
      case 'host':
        return 'forbidden';
      case 'anyone':
        this.advance(room, true);
        return null;
      case 'vote':
        if (room.skipVotes.has(userId)) {
          room.skipVotes.delete(userId);
        } else {
          room.skipVotes.add(userId);
        }
        if (!this.checkSkipVotes(room)) {
          this.broadcastPlayback(room);
        }
        return null;
    }
  }

  private checkSkipVotes(room: Room): boolean {
    if (room.settings.skipMode !== 'vote' || !room.current) {
      return false;
    }
    for (const voter of room.skipVotes) {
      if (!room.members.has(voter)) {
        room.skipVotes.delete(voter);
      }
    }
    const connected = [...room.members.values()].filter(
      (member) => member.connected,
    ).length;
    const threshold = jamSkipThreshold(connected);
    if (room.skipVotes.size > 0 && room.skipVotes.size >= threshold) {
      this.advance(room, true);
      return true;
    }
    return false;
  }

  private chatSend(userId: string, text: string): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    if (member.muted) {
      return 'muted';
    }
    if (!this.chatLimiter.allow(userId, this.now())) {
      return 'rate_limited';
    }

    this.appendChat(room, {
      id: newId(),
      kind: 'user',
      userId,
      displayName: member.displayName,
      text,
      at: this.now(),
    });
    return null;
  }

  private reactionSend(userId: string, emoji: string): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    if (member.muted) {
      return 'muted';
    }
    if (!this.reactionLimiter.allow(userId, this.now())) {
      return 'rate_limited';
    }

    this.broadcast(room, {
      type: 'reaction',
      userId,
      displayName: member.displayName,
      emoji,
    });
    return null;
  }

  private setRole(
    userId: string,
    targetId: string,
    role: 'cohost' | 'member',
  ): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    if (member.role !== 'host') {
      return 'forbidden';
    }
    const target = room.members.get(targetId);
    if (!target || target.role === 'host') {
      return target ? 'forbidden' : 'user_not_found';
    }

    target.role = role;
    this.broadcastState(room);
    return null;
  }

  private kick(userId: string, targetId: string): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    const target = room.members.get(targetId);
    if (!target) {
      return 'user_not_found';
    }
    if (!this.canModerate(member, target)) {
      return 'forbidden';
    }

    room.bans.set(targetId, this.now() + JAM_KICK_BAN_MS);
    return this.leaveRoom(targetId, 'kicked');
  }

  private mute(
    userId: string,
    targetId: string,
    muted: boolean,
  ): JamErrorCode | null {
    const room = this.roomFor(userId);
    const member = room?.members.get(userId);
    if (!room || !member) {
      return 'not_in_room';
    }
    const target = room.members.get(targetId);
    if (!target) {
      return 'user_not_found';
    }
    if (!this.canModerate(member, target)) {
      return 'forbidden';
    }

    target.muted = muted;
    this.broadcastState(room);
    return null;
  }

  private canModerate(actor: JamMember, target: JamMember): boolean {
    if (actor.userId === target.userId || target.role === 'host') {
      return false;
    }
    if (actor.role === 'host') {
      return true;
    }
    return actor.role === 'cohost' && target.role === 'member';
  }

  private sendRecap(userId: string): JamErrorCode | null {
    const room = this.roomFor(userId);
    if (!room) {
      return 'not_in_room';
    }
    this.sendToUser(userId, {
      type: 'room.recap',
      recap: this.buildRecap(room),
    });
    return null;
  }

  private buildRecap(room: Room): JamRecap {
    const [topEntry] = [...room.contributions.entries()].sort(
      (left, right) => right[1].count - left[1].count,
    );
    return {
      roomName: room.settings.name,
      durationMs: this.now() - room.createdAt,
      tracksPlayed: room.history.length,
      mostAdded: topCounts(room.adds),
      mostSkipped: topCounts(room.skips),
      topContributor: topEntry
        ? {
            userId: topEntry[0],
            displayName: topEntry[1].displayName,
            added: topEntry[1].count,
          }
        : null,
      history: structuredClone(room.history),
    };
  }

  private startItem(room: Room, item: JamQueueItem): void {
    room.current = item;
    room.skipVotes.clear();
    this.setPlayback(room, true, 0);
  }

  private advance(room: Room, skipped: boolean): void {
    const finished = room.current;
    if (finished) {
      room.history.push({
        track: finished.track,
        addedByName: finished.addedByName,
        skipped,
        playedAt: this.now(),
      });
      if (room.history.length > PLAYED_HISTORY_LIMIT) {
        room.history.shift();
      }
      if (skipped) {
        bump(room.skips, finished.track);
      }
    }

    const next = room.queue.shift() ?? null;
    if (next) {
      room.order.delete(next.id);
      this.startItem(room, next);
    } else {
      room.current = null;
      room.skipVotes.clear();
      this.setPlayback(room, false, 0);
    }
    this.broadcastState(room);
  }

  private setPlayback(room: Room, playing: boolean, positionMs: number): void {
    room.playback = { playing, positionMs, updatedAt: this.now() };
    this.scheduleAdvance(room);
  }

  private scheduleAdvance(room: Room): void {
    if (room.advanceTimer) {
      clearTimeout(room.advanceTimer);
      room.advanceTimer = null;
    }
    const durationMs = room.current?.track.durationMs;
    if (!durationMs || !room.playback.playing) {
      return;
    }

    const remainingMs = Math.max(0, durationMs - this.positionNow(room));
    room.advanceTimer = setTimeout(() => {
      room.advanceTimer = null;
      this.advance(room, false);
    }, remainingMs + ADVANCE_GRACE_MS);
    room.advanceTimer.unref();
  }

  private positionNow(room: Room): number {
    return jamExpectedPositionMs(room.playback, this.now());
  }

  private sortQueue(room: Room): void {
    room.queue.sort(
      (left, right) =>
        right.votes.length - left.votes.length ||
        (room.order.get(left.id) ?? 0) - (room.order.get(right.id) ?? 0),
    );
  }

  private listRooms(userId: string): JamRoomSummary[] {
    const genres = this.data.users[userId]?.genres ?? [];
    return [...this.rooms.values()]
      .filter((room) => room.settings.privacy === 'public')
      .map((room): JamRoomSummary => {
        const host = room.hostId ? room.members.get(room.hostId) : undefined;
        return {
          id: room.id,
          name: room.settings.name,
          genres: room.settings.genres,
          privacy: room.settings.privacy,
          capacity: room.settings.capacity,
          memberCount: room.members.size,
          hostName: host?.displayName ?? '',
          nowPlaying: room.current
            ? {
                title: room.current.track.title,
                artists: room.current.track.artists,
              }
            : null,
          match: computeTasteMatch(
            genres,
            room.settings.genres,
            [...room.members.values()].map((member) => member.genres),
          ),
          full: room.members.size >= room.settings.capacity,
        };
      })
      .sort(
        (left, right) =>
          right.match - left.match || right.memberCount - left.memberCount,
      );
  }

  private serialize(room: Room): JamRoomState {
    return structuredClone({
      ...room.settings,
      id: room.id,
      inviteCode: room.inviteCode,
      hostId: room.hostId ?? '',
      members: [...room.members.values()],
      current: room.current,
      queue: room.queue,
      playback: room.playback,
      skipVotes: [...room.skipVotes],
      eventId: room.eventId,
      createdAt: room.createdAt,
    });
  }

  private broadcast(
    room: Room,
    message: JamServerMessage,
    exceptUserId?: string,
  ): void {
    for (const member of room.members.values()) {
      if (member.userId !== exceptUserId) {
        this.sendToUser(member.userId, message);
      }
    }
  }

  private broadcastState(room: Room, exceptUserId?: string): void {
    this.broadcast(
      room,
      { type: 'room.state', room: this.serialize(room) },
      exceptUserId,
    );
  }

  private broadcastPlayback(room: Room): void {
    this.broadcast(
      room,
      structuredClone({
        type: 'playback.state' as const,
        currentId: room.current?.id ?? null,
        playback: room.playback,
        skipVotes: [...room.skipVotes],
      }),
    );
  }

  private addSystemMessage(
    room: Room,
    code: string,
    userId: string,
    displayName: string,
    exceptUserId?: string,
  ): void {
    this.appendChat(
      room,
      {
        id: newId(),
        kind: 'system',
        userId,
        displayName,
        text: code,
        at: this.now(),
      },
      exceptUserId,
    );
  }

  private appendChat(
    room: Room,
    message: JamChatMessage,
    exceptUserId?: string,
  ): void {
    room.chat.push(message);
    if (room.chat.length > CHAT_HISTORY_LIMIT) {
      room.chat.shift();
    }
    this.broadcast(room, { type: 'chat.message', message }, exceptUserId);
  }

  private openEventRoom(userId: string, event: JamEvent): JamErrorCode | null {
    const code = this.createRoom(
      userId,
      {
        name: event.title,
        genres: event.genres,
        privacy: event.privacy,
        capacity: event.capacity,
        skipMode: event.skipMode,
      },
      event.id,
    );
    if (code) {
      return code;
    }
    const roomId = this.roomOfUser.get(userId);
    event.roomId = roomId ?? null;
    return null;
  }

  private presenceOf(userId: string): {
    online: boolean;
    roomId: string | null;
    roomName: string | null;
  } {
    const room = this.roomFor(userId);
    const isPublic = room?.settings.privacy === 'public';
    return {
      online: this.sessionsByUser.has(userId),
      roomId: room && isPublic ? room.id : null,
      roomName: room && isPublic ? room.settings.name : null,
    };
  }

  private roomFor(userId: string): Room | undefined {
    const roomId = this.roomOfUser.get(userId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  private isNameTaken(name: string): boolean {
    const wanted = name.toLowerCase();
    return [...this.rooms.values()].some(
      (room) => room.settings.name.toLowerCase() === wanted,
    );
  }

  private userIdByFriendCode(code: string): string | null {
    const wanted = code.toUpperCase();
    const entry = Object.entries(this.data.users).find(
      ([, user]) => user.friendCode === wanted,
    );
    return entry ? entry[0] : null;
  }

  private uniqueFriendCode(): string {
    let code = newCode(FRIEND_CODE_LENGTH);
    while (this.userIdByFriendCode(code)) {
      code = newCode(FRIEND_CODE_LENGTH);
    }
    return code;
  }

  private sendToUser(userId: string, message: JamServerMessage): void {
    this.sessionsByUser.get(userId)?.connection.send(message);
  }

  private fail(session: Session, code: JamErrorCode, message: string): void {
    session.connection.send({ type: 'error', code, message });
  }

  private persist(): void {
    this.persistence.save(this.data);
  }
}
