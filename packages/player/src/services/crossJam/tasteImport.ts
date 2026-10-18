import { JAM_LIMITS, normalizeGenre } from '@nuclearplayer/model';
import type { TasteProvider } from '@nuclearplayer/plugin-sdk';

import { providersHost } from '../providersHost';

export class TasteImportError extends Error {}

export const mergeGenres = (
  current: string[],
  imported: string[],
  max: number,
): string[] => {
  const cleaned = imported
    .map(normalizeGenre)
    .filter((genre) => genre.length > 0)
    .map((genre) => genre.slice(0, JAM_LIMITS.genreMax));
  return [...new Set([...current, ...cleaned])].slice(0, max);
};

export const importGenresFromProvider = async (
  providerId: string,
  current: string[],
  max: number,
): Promise<string[]> => {
  const provider = providersHost.get<TasteProvider>(providerId, 'taste');
  if (!provider) {
    throw new TasteImportError(`Taste provider ${providerId} not found`);
  }
  const imported = await provider.fetchGenres();
  return mergeGenres(current, imported, max);
};
