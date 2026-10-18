import { LazyStore } from '@tauri-apps/plugin-store';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';

import type {
  JamChatMessage,
  JamErrorCode,
  JamEvent,
  JamFriend,
  JamFriendRequest,
  JamReaction,
  JamRecap,
  JamRole,
  JamRoomSettings,
  JamRoomState,
  JamRoomSummary,
  JamServerMessage,
  Track,
} from '@nuclearplayer/model';

import { jamClient } from '../services/crossJam/jamClient';
import type { ConnectionStatus } from '../services/crossJam/jamClient';
import { toJamTrack } from '../services/crossJam/trackMapping';
import { Logger } from '../services/logger';
import { errorMessage } from '../utils/errorMessage';
import { getSetting } from './settingsStore';

const CROSS_JAM_FILE = 'crossjam.json';
const CHAT_LIMIT = 200;
const REACTION_LIFETIME_MS = 3000;
const SERVER_URL_SETTING = 'core.crossJam.serverUrl';

const store = new LazyStore(CROSS_JAM_FILE);

export type CrossJamProfile = {
  userId: string;
  secret: string;
  displayName: string;
  genres: string[];
};

export type ReactionBurst = {
  id: string;
  emoji: string;
  displayName: string;
};

export type JoinTarget = { roomId: string } | { inviteCode: string };

export type CrossJamNotice = {
  code: JamErrorCode | 'kicked';
  id: number;
};

type CrossJamState = {
  profile: CrossJamProfile | null;
  status: ConnectionStatus;
  friendCode: string | null;
  notice: CrossJamNotice | null;
  rooms: JamRoomSummary[];
  room: JamRoomState | null;
  chat: JamChatMessage[];
  reactions: ReactionBurst[];
  recap: JamRecap | null;
  friends: JamFriend[];
  incomingRequests: JamFriendRequest[];
  outgoingRequests: JamFriendRequest[];
  events: JamEvent[];
  startingEvent: JamEvent | null;
};

type CrossJamActions = {
  loadProfile: () => Promise<void>;
  saveProfile: (changes: {
    displayName?: string;
    genres?: string[];
  }) => Promise<void>;
  connect: () => void;
  disconnect: () => void;
  handleMessage: (message: JamServerMessage) => void;
  refreshRooms: () => void;
  createRoom: (settings: JamRoomSettings) => void;
  joinRoom: (target: JoinTarget) => void;
  leaveRoom: () => void;
  updateRoomSettings: (settings: Partial<JamRoomSettings>) => void;
  addTrack: (track: Track) => void;
  removeQueueItem: (itemId: string) => void;
  voteQueueItem: (itemId: string) => void;
  skip: () => void;
  reportPlayback: (
    itemId: string,
    playing: boolean,
    positionMs: number,
  ) => void;
  reportEnded: (itemId: string) => void;
  sendChat: (text: string) => void;
  react: (emoji: JamReaction) => void;
  setRole: (userId: string, role: Exclude<JamRole, 'host'>) => void;
  kick: (userId: string) => void;
  mute: (userId: string, muted: boolean) => void;
  requestRecap: () => void;
  dismissRecap: () => void;
  refreshFriends: () => void;
  requestFriend: (friendCode: string) => void;
  respondToFriend: (userId: string, accept: boolean) => void;
  removeFriend: (userId: string) => void;
  refreshEvents: () => void;
  createEvent: (event: {
    title: string;
    description?: string;
    startsAt: number;
    genres: string[];
    privacy: 'public' | 'invite';
    capacity: number;
    skipMode: 'anyone' | 'vote' | 'host';
  }) => void;
  rsvp: (eventId: string, going: boolean) => void;
  cancelEvent: (eventId: string) => void;
  startEvent: (eventId: string) => void;
  dismissStartingEvent: () => void;
};

export type CrossJamStore = CrossJamState & CrossJamActions;

const initialState: CrossJamState = {
  profile: null,
  status: 'disconnected',
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
};

let noticeCounter = 0;
let reactionCounter = 0;

const createProfile = (): CrossJamProfile => ({
  userId: uuidv4(),
  secret: `${uuidv4()}${uuidv4()}`,
  displayName: '',
  genres: [],
});

export const useCrossJamStore = create<CrossJamStore>((set, get) => {
  const send: typeof jamClient.send = (message) => jamClient.send(message);

  const notify = (code: CrossJamNotice['code']) => {
    noticeCounter += 1;
    set({ notice: { code, id: noticeCounter } });
  };

  const persistProfile = async (profile: CrossJamProfile) => {
    try {
      await store.set('profile', profile);
      await store.save();
    } catch (error) {
      Logger.crossjam.error(`Failed to save profile: ${errorMessage(error)}`);
    }
  };

  return {
    ...initialState,

    loadProfile: async () => {
      const saved = await store.get<CrossJamProfile>('profile');
      const profile = saved ?? createProfile();
      if (!saved) {
        await persistProfile(profile);
      }
      set({ profile });
    },

    saveProfile: async (changes) => {
      const current = get().profile;
      if (!current) {
        return;
      }
      const profile = { ...current, ...changes };
      set({ profile });
      await persistProfile(profile);
      send({
        type: 'profile.update',
        displayName: changes.displayName,
        genres: changes.genres,
      });
    },

    connect: () => {
      const { profile } = get();
      const url = getSetting(SERVER_URL_SETTING) as string | undefined;
      if (!profile || !profile.displayName || !url) {
        return;
      }
      jamClient.connect(url, () => {
        const latest = get().profile ?? profile;
        return {
          type: 'hello',
          userId: latest.userId,
          secret: latest.secret,
          displayName: latest.displayName,
          genres: latest.genres,
        };
      });
    },

    disconnect: () => {
      jamClient.disconnect();
    },

    handleMessage: (message) => {
      switch (message.type) {
        case 'welcome':
          set((state) => ({
            friendCode: message.friendCode,
            room: message.resumedRoomId ? state.room : null,
            chat: message.resumedRoomId ? state.chat : [],
          }));
          send({ type: 'rooms.list' });
          send({ type: 'friends.list' });
          send({ type: 'events.list' });
          return;
        case 'error':
          notify(message.code);
          return;
        case 'rooms':
          set({ rooms: message.rooms });
          return;
        case 'room.joined':
          set({ room: message.room, chat: message.chat, recap: null });
          return;
        case 'room.state':
          set((state) =>
            state.room && state.room.id === message.room.id
              ? { room: message.room }
              : {},
          );
          return;
        case 'playback.state':
          set((state) =>
            state.room && (state.room.current?.id ?? null) === message.currentId
              ? {
                  room: {
                    ...state.room,
                    playback: message.playback,
                    skipVotes: message.skipVotes,
                  },
                }
              : {},
          );
          return;
        case 'room.left':
          set({ room: null, chat: [], recap: message.recap });
          if (message.reason === 'kicked') {
            notify('kicked');
          }
          return;
        case 'room.recap':
          set({ recap: message.recap });
          return;
        case 'chat.message':
          set((state) => ({
            chat: [...state.chat, message.message].slice(-CHAT_LIMIT),
          }));
          return;
        case 'reaction': {
          reactionCounter += 1;
          const burst: ReactionBurst = {
            id: `reaction-${reactionCounter}`,
            emoji: message.emoji,
            displayName: message.displayName,
          };
          set((state) => ({ reactions: [...state.reactions, burst] }));
          setTimeout(() => {
            set((state) => ({
              reactions: state.reactions.filter(
                (current) => current.id !== burst.id,
              ),
            }));
          }, REACTION_LIFETIME_MS);
          return;
        }
        case 'friends.state':
          set({
            friends: message.friends,
            incomingRequests: message.incoming,
            outgoingRequests: message.outgoing,
          });
          return;
        case 'events.state':
          set({ events: message.events });
          return;
        case 'event.starting':
          set({ startingEvent: message.event });
          return;
        case 'pong':
          return;
      }
    },

    refreshRooms: () => {
      send({ type: 'rooms.list' });
    },
    createRoom: (settings) => {
      send({ type: 'room.create', settings });
    },
    joinRoom: (target) => {
      send({ type: 'room.join', ...target });
    },
    leaveRoom: () => {
      send({ type: 'room.leave' });
    },
    updateRoomSettings: (settings) => {
      send({ type: 'room.updateSettings', settings });
    },
    addTrack: (track) => {
      send({ type: 'queue.add', track: toJamTrack(track) });
    },
    removeQueueItem: (itemId) => {
      send({ type: 'queue.remove', itemId });
    },
    voteQueueItem: (itemId) => {
      send({ type: 'queue.vote', itemId });
    },
    skip: () => {
      send({ type: 'playback.skip' });
    },
    reportPlayback: (itemId, playing, positionMs) => {
      send({ type: 'playback.update', itemId, playing, positionMs });
    },
    reportEnded: (itemId) => {
      send({ type: 'playback.ended', itemId });
    },
    sendChat: (text) => {
      send({ type: 'chat.send', text });
    },
    react: (emoji) => {
      send({ type: 'reaction.send', emoji });
    },
    setRole: (userId, role) => {
      send({ type: 'member.setRole', userId, role });
    },
    kick: (userId) => {
      send({ type: 'member.kick', userId });
    },
    mute: (userId, muted) => {
      send({ type: 'member.mute', userId, muted });
    },
    requestRecap: () => {
      send({ type: 'room.recap' });
    },
    dismissRecap: () => {
      set({ recap: null });
    },
    refreshFriends: () => {
      send({ type: 'friends.list' });
    },
    requestFriend: (friendCode) => {
      send({ type: 'friends.request', friendCode });
    },
    respondToFriend: (userId, accept) => {
      send({ type: 'friends.respond', userId, accept });
    },
    removeFriend: (userId) => {
      send({ type: 'friends.remove', userId });
    },
    refreshEvents: () => {
      send({ type: 'events.list' });
    },
    createEvent: (event) => {
      send({ type: 'events.create', ...event });
    },
    rsvp: (eventId, going) => {
      send({ type: 'events.rsvp', eventId, going });
    },
    cancelEvent: (eventId) => {
      send({ type: 'events.cancel', eventId });
    },
    startEvent: (eventId) => {
      send({ type: 'events.start', eventId });
    },
    dismissStartingEvent: () => {
      set({ startingEvent: null });
    },
  };
});

export const initializeCrossJamStore = async (): Promise<void> => {
  await useCrossJamStore.getState().loadProfile();
  jamClient.onMessage((message) =>
    useCrossJamStore.getState().handleMessage(message),
  );
  jamClient.onStatus((status) => {
    useCrossJamStore.setState({
      status,
      ...(status === 'disconnected' ? { rooms: [], room: null, chat: [] } : {}),
    });
  });
};
