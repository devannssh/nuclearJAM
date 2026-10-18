import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { PersistedData, Persistence } from './types';

export const emptyData = (): PersistedData => ({
  users: {},
  friendships: [],
  requests: [],
  events: [],
});

export const createMemoryPersistence = (
  initial: PersistedData = emptyData(),
): Persistence & { snapshot: () => PersistedData } => {
  let stored = structuredClone(initial);
  return {
    load: () => structuredClone(stored),
    save: (data) => {
      stored = structuredClone(data);
    },
    snapshot: () => structuredClone(stored),
  };
};

const SAVE_DEBOUNCE_MS = 500;

export const createFilePersistence = (filePath: string): Persistence => {
  let pending: PersistedData | null = null;
  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    timer = null;
    if (!pending) {
      return;
    }
    const data = pending;
    pending = null;
    mkdirSync(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(data));
    renameSync(tempPath, filePath);
  };

  return {
    load: () => {
      if (!existsSync(filePath)) {
        return emptyData();
      }
      return { ...emptyData(), ...JSON.parse(readFileSync(filePath, 'utf8')) };
    },
    save: (data) => {
      pending = structuredClone(data);
      if (!timer) {
        timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
        timer.unref();
      }
    },
  };
};
