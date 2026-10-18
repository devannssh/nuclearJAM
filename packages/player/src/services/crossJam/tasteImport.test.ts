import { afterEach, describe, expect, it } from 'vitest';

import type { TasteProvider } from '@nuclearplayer/plugin-sdk';

import { providersHost } from '../providersHost';
import { importGenresFromProvider, mergeGenres } from './tasteImport';

const registerTaste = (genres: string[] | Error): TasteProvider => {
  const provider: TasteProvider = {
    id: 'lastfm',
    kind: 'taste',
    name: 'Last.fm',
    fetchGenres: async () => {
      if (genres instanceof Error) {
        throw genres;
      }
      return genres;
    },
  };
  providersHost.register(provider);
  return provider;
};

describe('Cross Jam taste import', () => {
  afterEach(() => {
    providersHost.clear();
  });

  describe('mergeGenres', () => {
    it('keeps existing genres and adds new ones', () => {
      expect(mergeGenres(['house'], ['jazz', 'blues'], 10)).toEqual([
        'house',
        'jazz',
        'blues',
      ]);
    });

    it('normalizes and de-duplicates imported genres', () => {
      expect(
        mergeGenres(['house'], [' House ', 'JAZZ', 'jazz', '  '], 10),
      ).toEqual(['house', 'jazz']);
    });

    it('never exceeds the maximum', () => {
      expect(mergeGenres(['a', 'b'], ['c', 'd', 'e'], 3)).toEqual([
        'a',
        'b',
        'c',
      ]);
    });

    it('trims overly long genre names', () => {
      const [genre] = mergeGenres([], ['x'.repeat(100)], 5);

      expect(genre).toHaveLength(24);
    });
  });

  describe('importGenresFromProvider', () => {
    it('merges the provider’s genres into the current ones', async () => {
      registerTaste(['Jazz', 'Soul']);

      const result = await importGenresFromProvider('lastfm', ['house'], 10);

      expect(result).toEqual(['house', 'jazz', 'soul']);
    });

    it('fails clearly when the provider is gone', async () => {
      await expect(importGenresFromProvider('missing', [], 10)).rejects.toThrow(
        'not found',
      );
    });

    it('passes provider failures through', async () => {
      registerTaste(new Error('network down'));

      await expect(importGenresFromProvider('lastfm', [], 10)).rejects.toThrow(
        'network down',
      );
    });
  });
});
