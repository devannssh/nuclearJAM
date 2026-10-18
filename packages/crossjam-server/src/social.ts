import type {
  JamClientMessage,
  JamErrorCode,
  JamEvent,
  JamFriend,
  JamFriendRequest,
  JamServerMessage,
} from '@nuclearplayer/model';

import { newId } from './ids';
import type { PersistedData } from './types';

const SWEEP_INTERVAL_MS = 30 * 1000;
const START_TOLERANCE_MS = 60 * 1000;
const UNSTARTED_EVENT_TTL_MS = 3 * 60 * 60 * 1000;
const FINISHED_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;
const ACTIVE_EVENTS_PER_HOST = 5;

export type SocialDeps = {
  now: () => number;
  data: PersistedData;
  persist: () => void;
  sendTo: (userId: string, message: JamServerMessage) => void;
  presenceOf: (userId: string) => {
    online: boolean;
    roomId: string | null;
    roomName: string | null;
  };
  displayNameOf: (userId: string) => string | null;
  userIdByFriendCode: (code: string) => string | null;
  openEventRoom: (userId: string, event: JamEvent) => JamErrorCode | null;
  isRoomAlive: (roomId: string) => boolean;
};

type SocialMessage = Extract<
  JamClientMessage,
  {
    type:
      | 'friends.list'
      | 'friends.request'
      | 'friends.respond'
      | 'friends.remove'
      | 'events.list'
      | 'events.create'
      | 'events.rsvp'
      | 'events.cancel'
      | 'events.start';
  }
>;

export class SocialService {
  private readonly notified = new Set<string>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly deps: SocialDeps) {
    this.sweepTimer = setInterval(() => this.sweepEvents(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  dispose(): void {
    clearInterval(this.sweepTimer);
  }

  handle(userId: string, message: SocialMessage): JamErrorCode | null {
    switch (message.type) {
      case 'friends.list':
        this.pushFriends(userId);
        return null;
      case 'friends.request':
        return this.requestFriend(userId, message.friendCode);
      case 'friends.respond':
        return this.respondToRequest(userId, message.userId, message.accept);
      case 'friends.remove':
        return this.removeFriend(userId, message.userId);
      case 'events.list':
        this.pushEvents(userId);
        return null;
      case 'events.create':
        return this.createEvent(userId, message);
      case 'events.rsvp':
        return this.rsvp(userId, message.eventId, message.going);
      case 'events.cancel':
        return this.cancelEvent(userId, message.eventId);
      case 'events.start':
        return this.startEvent(userId, message.eventId);
    }
  }

  presenceChanged(userId: string): void {
    for (const friendId of this.friendIds(userId)) {
      if (this.deps.presenceOf(friendId).online) {
        this.pushFriends(friendId);
      }
    }
  }

  roomClosed(roomId: string): void {
    const event = this.deps.data.events.find(
      (candidate) => candidate.roomId === roomId && candidate.status === 'live',
    );
    if (event) {
      event.status = 'ended';
      this.deps.persist();
    }
  }

  private friendIds(userId: string): string[] {
    return this.deps.data.friendships
      .filter((pair) => pair.includes(userId))
      .map((pair) => (pair[0] === userId ? pair[1] : pair[0]));
  }

  private areFriends(left: string, right: string): boolean {
    return this.friendIds(left).includes(right);
  }

  private pushFriends(userId: string): void {
    const friends = this.friendIds(userId).map((friendId): JamFriend => {
      const presence = this.deps.presenceOf(friendId);
      return {
        userId: friendId,
        displayName: this.deps.displayNameOf(friendId) ?? '',
        status: presence.online ? 'online' : 'offline',
        roomId: presence.roomId,
        roomName: presence.roomName,
      };
    });
    const toRequest = (otherId: string): JamFriendRequest => ({
      userId: otherId,
      displayName: this.deps.displayNameOf(otherId) ?? '',
    });

    this.deps.sendTo(userId, {
      type: 'friends.state',
      friends,
      incoming: this.deps.data.requests
        .filter((request) => request.to === userId)
        .map((request) => toRequest(request.from)),
      outgoing: this.deps.data.requests
        .filter((request) => request.from === userId)
        .map((request) => toRequest(request.to)),
    });
  }

  private requestFriend(
    userId: string,
    friendCode: string,
  ): JamErrorCode | null {
    const targetId = this.deps.userIdByFriendCode(friendCode);
    if (!targetId) {
      return 'user_not_found';
    }
    if (targetId === userId) {
      return 'self_request';
    }
    if (this.areFriends(userId, targetId)) {
      return 'already_friends';
    }

    const { data } = this.deps;
    const reverse = data.requests.some(
      (request) => request.from === targetId && request.to === userId,
    );
    if (reverse) {
      return this.respondToRequest(userId, targetId, true);
    }

    const duplicate = data.requests.some(
      (request) => request.from === userId && request.to === targetId,
    );
    if (!duplicate) {
      data.requests.push({ from: userId, to: targetId });
      this.deps.persist();
    }
    this.pushFriends(userId);
    this.pushFriends(targetId);
    return null;
  }

  private respondToRequest(
    userId: string,
    requesterId: string,
    accept: boolean,
  ): JamErrorCode | null {
    const { data } = this.deps;
    const exists = data.requests.some(
      (request) => request.from === requesterId && request.to === userId,
    );
    if (!exists) {
      return 'user_not_found';
    }

    data.requests = data.requests.filter(
      (request) =>
        !(
          (request.from === requesterId && request.to === userId) ||
          (request.from === userId && request.to === requesterId)
        ),
    );
    if (accept && !this.areFriends(userId, requesterId)) {
      data.friendships.push([requesterId, userId]);
    }
    this.deps.persist();
    this.pushFriends(userId);
    this.pushFriends(requesterId);
    return null;
  }

  private removeFriend(userId: string, friendId: string): JamErrorCode | null {
    const { data } = this.deps;
    data.friendships = data.friendships.filter(
      (pair) => !(pair.includes(userId) && pair.includes(friendId)),
    );
    this.deps.persist();
    this.pushFriends(userId);
    this.pushFriends(friendId);
    return null;
  }

  private visibleEvents(userId: string): JamEvent[] {
    return this.deps.data.events
      .filter(
        (event) =>
          (event.status === 'scheduled' || event.status === 'live') &&
          (event.privacy === 'public' ||
            event.hostId === userId ||
            event.rsvps.includes(userId)),
      )
      .sort((left, right) => left.startsAt - right.startsAt);
  }

  private pushEvents(userId: string): void {
    this.deps.sendTo(userId, {
      type: 'events.state',
      events: structuredClone(this.visibleEvents(userId)),
    });
  }

  private pushEventsToParticipants(event: JamEvent): void {
    const participants = new Set([event.hostId, ...event.rsvps]);
    for (const participantId of participants) {
      this.pushEvents(participantId);
    }
  }

  private createEvent(
    userId: string,
    message: Extract<SocialMessage, { type: 'events.create' }>,
  ): JamErrorCode | null {
    const now = this.deps.now();
    if (message.startsAt < now - START_TOLERANCE_MS) {
      return 'event_in_past';
    }
    const activeByHost = this.deps.data.events.filter(
      (event) => event.hostId === userId && event.status === 'scheduled',
    ).length;
    if (activeByHost >= ACTIVE_EVENTS_PER_HOST) {
      return 'member_limit';
    }

    this.deps.data.events.push({
      id: newId(),
      title: message.title,
      description: message.description ?? '',
      hostId: userId,
      hostName: this.deps.displayNameOf(userId) ?? '',
      startsAt: message.startsAt,
      genres: message.genres,
      privacy: message.privacy,
      capacity: message.capacity,
      skipMode: message.skipMode,
      rsvps: [userId],
      status: 'scheduled',
      roomId: null,
    });
    this.deps.persist();
    this.pushEvents(userId);
    return null;
  }

  private findEvent(eventId: string): JamEvent | undefined {
    return this.deps.data.events.find((event) => event.id === eventId);
  }

  private rsvp(
    userId: string,
    eventId: string,
    going: boolean,
  ): JamErrorCode | null {
    const event = this.findEvent(eventId);
    if (!event || (event.status !== 'scheduled' && event.status !== 'live')) {
      return 'event_not_found';
    }

    const attending = event.rsvps.includes(userId);
    if (going && !attending) {
      event.rsvps.push(userId);
    }
    if (!going && attending) {
      event.rsvps = event.rsvps.filter((rsvp) => rsvp !== userId);
    }
    this.deps.persist();
    this.pushEvents(userId);
    return null;
  }

  private cancelEvent(userId: string, eventId: string): JamErrorCode | null {
    const event = this.findEvent(eventId);
    if (!event || event.status !== 'scheduled') {
      return 'event_not_found';
    }
    if (event.hostId !== userId) {
      return 'forbidden';
    }

    event.status = 'cancelled';
    this.deps.persist();
    this.pushEventsToParticipants(event);
    return null;
  }

  private startEvent(userId: string, eventId: string): JamErrorCode | null {
    const event = this.findEvent(eventId);
    if (!event || event.status !== 'scheduled') {
      return 'event_not_found';
    }
    if (event.hostId !== userId) {
      return 'forbidden';
    }

    const code = this.deps.openEventRoom(userId, event);
    if (code) {
      return code;
    }

    event.status = 'live';
    this.deps.persist();
    for (const rsvpId of event.rsvps) {
      if (rsvpId !== userId) {
        this.deps.sendTo(rsvpId, {
          type: 'event.starting',
          event: structuredClone(event),
        });
      }
    }
    this.pushEventsToParticipants(event);
    return null;
  }

  private sweepEvents(): void {
    const now = this.deps.now();
    let changed = false;

    for (const event of this.deps.data.events) {
      const due = event.status === 'scheduled' && event.startsAt <= now;
      if (due && !this.notified.has(event.id)) {
        this.notified.add(event.id);
        for (const participantId of new Set([event.hostId, ...event.rsvps])) {
          this.deps.sendTo(participantId, {
            type: 'event.starting',
            event: structuredClone(event),
          });
        }
      }

      const abandoned =
        event.status === 'scheduled' &&
        event.startsAt + UNSTARTED_EVENT_TTL_MS < now;
      const roomGone =
        event.status === 'live' &&
        (!event.roomId || !this.deps.isRoomAlive(event.roomId));
      if (abandoned || roomGone) {
        event.status = 'ended';
        changed = true;
      }
    }

    const before = this.deps.data.events.length;
    this.deps.data.events = this.deps.data.events.filter(
      (event) =>
        (event.status !== 'ended' && event.status !== 'cancelled') ||
        event.startsAt + FINISHED_EVENT_RETENTION_MS > now,
    );
    if (changed || this.deps.data.events.length !== before) {
      this.deps.persist();
    }
  }
}
