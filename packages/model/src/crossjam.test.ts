import { describe, expect, it } from 'vitest';

import {
  computeTasteMatch,
  jamClientMessageSchema,
  jamExpectedPositionMs,
  normalizeGenre,
} from './crossjam';

describe('computeTasteMatch', () => {
  it('is 100 when the user likes exactly the room genres', () => {
    expect(
      computeTasteMatch(['house', 'techno'], ['house', 'techno'], []),
    ).toBe(100);
  });

  it('is 0 with no overlap', () => {
    expect(computeTasteMatch(['jazz'], ['metal'], [['punk']])).toBe(0);
  });

  it('is 0 when the user has no genres or the room has no signal', () => {
    expect(computeTasteMatch([], ['house'], [])).toBe(0);
    expect(computeTasteMatch(['house'], [], [])).toBe(0);
  });

  it('is partial when genres partly overlap', () => {
    const match = computeTasteMatch(['house', 'jazz'], ['house'], []);
    expect(match).toBeGreaterThan(0);
    expect(match).toBeLessThan(100);
  });

  it('is case and whitespace insensitive', () => {
    expect(computeTasteMatch([' House '], ['house'], [])).toBe(100);
  });

  it('lets what the members actually like shift the match', () => {
    const tagsOnly = computeTasteMatch(['jazz'], ['house'], []);
    const withJazzMembers = computeTasteMatch(
      ['jazz'],
      ['house'],
      [['jazz'], ['jazz']],
    );
    expect(withJazzMembers).toBeGreaterThan(tagsOnly);
  });
});

describe('normalizeGenre', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeGenre('  Drum   And Bass ')).toBe('drum and bass');
  });
});

describe('jamExpectedPositionMs', () => {
  it('advances while playing and stands still while paused', () => {
    const base = { positionMs: 1000, updatedAt: 5000 };
    expect(jamExpectedPositionMs({ ...base, playing: true }, 8000)).toBe(4000);
    expect(jamExpectedPositionMs({ ...base, playing: false }, 8000)).toBe(1000);
  });

  it('never goes backwards when clocks are slightly off', () => {
    expect(
      jamExpectedPositionMs(
        { playing: true, positionMs: 1000, updatedAt: 9000 },
        8000,
      ),
    ).toBe(1000);
  });
});

describe('jamClientMessageSchema', () => {
  it('normalizes and de-duplicates genres', () => {
    const parsed = jamClientMessageSchema.parse({
      type: 'hello',
      userId: 'user-12345',
      secret: 'secret-1234567890',
      displayName: ' Sam ',
      genres: ['Rock', 'rock ', 'Jazz'],
    });
    expect(parsed).toMatchObject({
      displayName: 'Sam',
      genres: ['rock', 'jazz'],
    });
  });

  it('rejects out-of-range room capacity', () => {
    const result = jamClientMessageSchema.safeParse({
      type: 'room.create',
      settings: {
        name: 'x',
        genres: [],
        privacy: 'public',
        capacity: 500,
        skipMode: 'anyone',
      },
    });
    expect(result.success).toBe(false);
  });
});
