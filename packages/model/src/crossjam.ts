import { z } from 'zod';

export const JAM_LIMITS = {
  displayNameMax: 24,
  roomNameMax: 40,
  chatMax: 500,
  genreMax: 24,
  genresPerRoom: 5,
  genresPerProfile: 10,
  capacityMin: 2,
  capacityMax: 50,
  queueMax: 200,
  queuedPerMember: 10,
  eventTitleMax: 60,
  eventDescriptionMax: 280,
} as const;

export const JAM_EMPTY_ROOM_TTL_MS = 2 * 60 * 1000;
export const JAM_RESUME_GRACE_MS = 15 * 1000;
export const JAM_KICK_BAN_MS = 10 * 60 * 1000;
export const JAM_REACTIONS = [
  '🔥',
  '❤️',
  '👏',
  '😂',
  '🎉',
  '😍',
  '🤘',
  '👎',
] as const;
export type JamReaction = (typeof JAM_REACTIONS)[number];

export const JAM_SUGGESTED_GENRES = [
  'pop',
  'rock',
  'hip hop',
  'r&b',
  'electronic',
  'house',
  'techno',
  'drum and bass',
  'ambient',
  'indie',
  'alternative',
  'metal',
  'punk',
  'jazz',
  'blues',
  'classical',
  'folk',
  'country',
  'reggae',
  'latin',
  'k-pop',
  'j-pop',
  'bollywood',
  'soul',
  'funk',
  'disco',
  'lo-fi',
  'soundtrack',
  'synthwave',
  'trap',
] as const;

export const normalizeGenre = (genre: string): string =>
  genre.trim().toLowerCase().replace(/\s+/g, ' ');

const genreSchema = z
  .string()
  .transform(normalizeGenre)
  .pipe(z.string().min(1).max(JAM_LIMITS.genreMax));

const uniqueGenres = (genres: string[]): string[] => [...new Set(genres)];

const genresSchema = (max: number) =>
  z.array(genreSchema).max(max).transform(uniqueGenres);

const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(JAM_LIMITS.displayNameMax);

const roomNameSchema = z.string().trim().min(1).max(JAM_LIMITS.roomNameMax);

const idSchema = z.string().min(1).max(64);

export const jamPrivacySchema = z.enum(['public', 'invite']);
export type JamPrivacy = z.infer<typeof jamPrivacySchema>;

export const jamSkipModeSchema = z.enum(['anyone', 'vote', 'host']);
export type JamSkipMode = z.infer<typeof jamSkipModeSchema>;

export const jamRoleSchema = z.enum(['host', 'cohost', 'member']);
export type JamRole = z.infer<typeof jamRoleSchema>;

export const jamTrackSchema = z.object({
  title: z.string().min(1).max(300),
  artists: z.array(z.string().min(1).max(200)).max(10),
  album: z.string().max(300).optional(),
  durationMs: z.number().int().positive().max(86_400_000).optional(),
  artworkUrl: z.string().max(2000).optional(),
  source: z.object({
    provider: z.string().min(1).max(100),
    id: z.string().min(1).max(300),
  }),
});
export type JamTrack = z.infer<typeof jamTrackSchema>;

export const jamTrackKey = (track: JamTrack): string =>
  `${track.source.provider}:${track.source.id}`;

export const jamRoomSettingsSchema = z.object({
  name: roomNameSchema,
  genres: genresSchema(JAM_LIMITS.genresPerRoom),
  privacy: jamPrivacySchema,
  capacity: z
    .number()
    .int()
    .min(JAM_LIMITS.capacityMin)
    .max(JAM_LIMITS.capacityMax),
  skipMode: jamSkipModeSchema,
});
export type JamRoomSettings = z.infer<typeof jamRoomSettingsSchema>;

const clientMessageSchemas = {
  hello: z.object({
    type: z.literal('hello'),
    userId: z.string().min(8).max(64),
    secret: z.string().min(16).max(128),
    displayName: displayNameSchema,
    genres: genresSchema(JAM_LIMITS.genresPerProfile),
  }),
  ping: z.object({ type: z.literal('ping'), clientTime: z.number() }),
  profileUpdate: z.object({
    type: z.literal('profile.update'),
    displayName: displayNameSchema.optional(),
    genres: genresSchema(JAM_LIMITS.genresPerProfile).optional(),
  }),
  roomsList: z.object({ type: z.literal('rooms.list') }),
  roomCreate: z.object({
    type: z.literal('room.create'),
    settings: jamRoomSettingsSchema,
  }),
  roomJoin: z.object({
    type: z.literal('room.join'),
    roomId: idSchema.optional(),
    inviteCode: z.string().trim().min(1).max(16).optional(),
  }),
  roomLeave: z.object({ type: z.literal('room.leave') }),
  roomRecap: z.object({ type: z.literal('room.recap') }),
  roomUpdateSettings: z.object({
    type: z.literal('room.updateSettings'),
    settings: jamRoomSettingsSchema.partial(),
  }),
  queueAdd: z.object({ type: z.literal('queue.add'), track: jamTrackSchema }),
  queueRemove: z.object({ type: z.literal('queue.remove'), itemId: idSchema }),
  queueVote: z.object({ type: z.literal('queue.vote'), itemId: idSchema }),
  playbackUpdate: z.object({
    type: z.literal('playback.update'),
    itemId: idSchema,
    playing: z.boolean(),
    positionMs: z.number().min(0).max(86_400_000),
  }),
  playbackSkip: z.object({ type: z.literal('playback.skip') }),
  playbackEnded: z.object({
    type: z.literal('playback.ended'),
    itemId: idSchema,
  }),
  chatSend: z.object({
    type: z.literal('chat.send'),
    text: z.string().trim().min(1).max(JAM_LIMITS.chatMax),
  }),
  reactionSend: z.object({
    type: z.literal('reaction.send'),
    emoji: z.enum(JAM_REACTIONS),
  }),
  memberSetRole: z.object({
    type: z.literal('member.setRole'),
    userId: idSchema,
    role: z.enum(['cohost', 'member']),
  }),
  memberKick: z.object({ type: z.literal('member.kick'), userId: idSchema }),
  memberMute: z.object({
    type: z.literal('member.mute'),
    userId: idSchema,
    muted: z.boolean(),
  }),
  friendsList: z.object({ type: z.literal('friends.list') }),
  friendsRequest: z.object({
    type: z.literal('friends.request'),
    friendCode: z.string().trim().min(1).max(16),
  }),
  friendsRespond: z.object({
    type: z.literal('friends.respond'),
    userId: idSchema,
    accept: z.boolean(),
  }),
  friendsRemove: z.object({
    type: z.literal('friends.remove'),
    userId: idSchema,
  }),
  eventsList: z.object({ type: z.literal('events.list') }),
  eventsCreate: z.object({
    type: z.literal('events.create'),
    title: z.string().trim().min(1).max(JAM_LIMITS.eventTitleMax),
    description: z
      .string()
      .trim()
      .max(JAM_LIMITS.eventDescriptionMax)
      .optional(),
    startsAt: z.number().int(),
    genres: genresSchema(JAM_LIMITS.genresPerRoom),
    privacy: jamPrivacySchema,
    capacity: z
      .number()
      .int()
      .min(JAM_LIMITS.capacityMin)
      .max(JAM_LIMITS.capacityMax),
    skipMode: jamSkipModeSchema,
  }),
  eventsRsvp: z.object({
    type: z.literal('events.rsvp'),
    eventId: idSchema,
    going: z.boolean(),
  }),
  eventsCancel: z.object({
    type: z.literal('events.cancel'),
    eventId: idSchema,
  }),
  eventsStart: z.object({ type: z.literal('events.start'), eventId: idSchema }),
};

export const jamClientMessageSchema = z.discriminatedUnion('type', [
  clientMessageSchemas.hello,
  clientMessageSchemas.ping,
  clientMessageSchemas.profileUpdate,
  clientMessageSchemas.roomsList,
  clientMessageSchemas.roomCreate,
  clientMessageSchemas.roomJoin,
  clientMessageSchemas.roomLeave,
  clientMessageSchemas.roomRecap,
  clientMessageSchemas.roomUpdateSettings,
  clientMessageSchemas.queueAdd,
  clientMessageSchemas.queueRemove,
  clientMessageSchemas.queueVote,
  clientMessageSchemas.playbackUpdate,
  clientMessageSchemas.playbackSkip,
  clientMessageSchemas.playbackEnded,
  clientMessageSchemas.chatSend,
  clientMessageSchemas.reactionSend,
  clientMessageSchemas.memberSetRole,
  clientMessageSchemas.memberKick,
  clientMessageSchemas.memberMute,
  clientMessageSchemas.friendsList,
  clientMessageSchemas.friendsRequest,
  clientMessageSchemas.friendsRespond,
  clientMessageSchemas.friendsRemove,
  clientMessageSchemas.eventsList,
  clientMessageSchemas.eventsCreate,
  clientMessageSchemas.eventsRsvp,
  clientMessageSchemas.eventsCancel,
  clientMessageSchemas.eventsStart,
]);
export type JamClientMessage = z.infer<typeof jamClientMessageSchema>;
export type JamClientMessageInput = z.input<typeof jamClientMessageSchema>;

export type JamMember = {
  userId: string;
  displayName: string;
  genres: string[];
  role: JamRole;
  muted: boolean;
  connected: boolean;
  joinedAt: number;
};

export type JamQueueItem = {
  id: string;
  track: JamTrack;
  addedBy: string;
  addedByName: string;
  addedAt: number;
  votes: string[];
};

export type JamPlayback = {
  playing: boolean;
  positionMs: number;
  updatedAt: number;
};

export type JamPlaybackState = {
  currentId: string | null;
  playback: JamPlayback;
  skipVotes: string[];
};

export type JamRoomState = JamRoomSettings & {
  id: string;
  inviteCode: string | null;
  hostId: string;
  members: JamMember[];
  current: JamQueueItem | null;
  queue: JamQueueItem[];
  playback: JamPlayback;
  skipVotes: string[];
  eventId: string | null;
  createdAt: number;
};

export type JamHistoryEntry = {
  track: JamTrack;
  addedByName: string;
  skipped: boolean;
  playedAt: number;
};

export type JamRoomSummary = {
  id: string;
  name: string;
  genres: string[];
  privacy: JamPrivacy;
  capacity: number;
  memberCount: number;
  hostName: string;
  nowPlaying: { title: string; artists: string[] } | null;
  match: number;
  full: boolean;
};

export type JamChatMessage = {
  id: string;
  kind: 'user' | 'system';
  userId: string | null;
  displayName: string | null;
  text: string;
  at: number;
};

export type JamRecapTrackCount = { track: JamTrack; count: number };

export type JamRecap = {
  roomName: string;
  durationMs: number;
  tracksPlayed: number;
  mostAdded: JamRecapTrackCount[];
  mostSkipped: JamRecapTrackCount[];
  topContributor: {
    userId: string;
    displayName: string;
    added: number;
  } | null;
  history: JamHistoryEntry[];
};

export type JamFriendStatus = 'online' | 'offline';

export type JamFriend = {
  userId: string;
  displayName: string;
  status: JamFriendStatus;
  roomId: string | null;
  roomName: string | null;
};

export type JamFriendRequest = { userId: string; displayName: string };

export type JamEventStatus = 'scheduled' | 'live' | 'cancelled' | 'ended';

export type JamEvent = {
  id: string;
  title: string;
  description: string;
  hostId: string;
  hostName: string;
  startsAt: number;
  genres: string[];
  privacy: JamPrivacy;
  capacity: number;
  skipMode: JamSkipMode;
  rsvps: string[];
  status: JamEventStatus;
  roomId: string | null;
};

export type JamErrorCode =
  | 'invalid_message'
  | 'not_identified'
  | 'bad_credentials'
  | 'rate_limited'
  | 'not_in_room'
  | 'already_in_room'
  | 'room_not_found'
  | 'room_full'
  | 'invite_required'
  | 'banned'
  | 'forbidden'
  | 'muted'
  | 'duplicate_track'
  | 'queue_full'
  | 'member_limit'
  | 'item_not_found'
  | 'user_not_found'
  | 'already_friends'
  | 'self_request'
  | 'event_not_found'
  | 'event_in_past'
  | 'name_taken';

export type JamServerMessage =
  | {
      type: 'welcome';
      userId: string;
      friendCode: string;
      serverTime: number;
      resumedRoomId: string | null;
    }
  | { type: 'pong'; clientTime: number; serverTime: number }
  | { type: 'error'; code: JamErrorCode; message: string }
  | { type: 'rooms'; rooms: JamRoomSummary[] }
  | { type: 'room.joined'; room: JamRoomState; chat: JamChatMessage[] }
  | { type: 'room.state'; room: JamRoomState }
  | ({ type: 'playback.state' } & JamPlaybackState)
  | {
      type: 'room.left';
      reason: 'left' | 'kicked' | 'closed';
      recap: JamRecap | null;
    }
  | { type: 'room.recap'; recap: JamRecap }
  | { type: 'chat.message'; message: JamChatMessage }
  | { type: 'reaction'; userId: string; displayName: string; emoji: string }
  | {
      type: 'friends.state';
      friends: JamFriend[];
      incoming: JamFriendRequest[];
      outgoing: JamFriendRequest[];
    }
  | { type: 'events.state'; events: JamEvent[] }
  | { type: 'event.starting'; event: JamEvent };

export const jamExpectedPositionMs = (
  playback: JamPlayback,
  serverNow: number,
): number =>
  playback.playing
    ? playback.positionMs + Math.max(0, serverNow - playback.updatedAt)
    : playback.positionMs;

export const jamSkipThreshold = (connectedMembers: number): number =>
  Math.floor(connectedMembers / 2) + 1;

const cosineSimilarity = (
  left: Map<string, number>,
  right: Map<string, number>,
): number => {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [genre, weight] of left) {
    leftNorm += weight * weight;
    dot += weight * (right.get(genre) ?? 0);
  }
  for (const weight of right.values()) {
    rightNorm += weight * weight;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

const ROOM_TAG_WEIGHT = 2;

export const computeTasteMatch = (
  userGenres: string[],
  roomGenres: string[],
  memberGenres: string[][],
): number => {
  const userVector = new Map<string, number>();
  for (const genre of userGenres) {
    userVector.set(normalizeGenre(genre), 1);
  }

  const roomVector = new Map<string, number>();
  for (const genre of roomGenres) {
    const key = normalizeGenre(genre);
    roomVector.set(key, (roomVector.get(key) ?? 0) + ROOM_TAG_WEIGHT);
  }
  for (const genres of memberGenres) {
    for (const genre of genres) {
      const key = normalizeGenre(genre);
      roomVector.set(key, (roomVector.get(key) ?? 0) + 1);
    }
  }

  return Math.round(cosineSimilarity(userVector, roomVector) * 100);
};
