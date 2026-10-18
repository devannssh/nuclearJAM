import type { JamEvent, JamServerMessage } from '@nuclearplayer/model';

export type Connection = {
  send: (message: JamServerMessage) => void;
  close: () => void;
};

export type PersistedUser = {
  displayName: string;
  genres: string[];
  friendCode: string;
  secretHash: string;
};

export type PersistedRequest = { from: string; to: string };

export type PersistedData = {
  users: Record<string, PersistedUser>;
  friendships: [string, string][];
  requests: PersistedRequest[];
  events: JamEvent[];
};

export type Persistence = {
  load: () => PersistedData;
  save: (data: PersistedData) => void;
};
