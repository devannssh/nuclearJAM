import type { Track } from '@nuclearplayer/model';

export type QueueInterceptor = {
  addTracks: (tracks: Track[]) => void;
  skip: () => void;
  trackEnded: (itemId: string) => void;
  removeItems: (itemIds: string[]) => void;
};

let activeInterceptor: QueueInterceptor | null = null;

export const setQueueInterceptor = (interceptor: QueueInterceptor | null) => {
  activeInterceptor = interceptor;
};

export const getQueueInterceptor = (): QueueInterceptor | null =>
  activeInterceptor;
