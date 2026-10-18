import type { JamTrack, Track } from '@nuclearplayer/model';

export const toJamTrack = (track: Track): JamTrack => ({
  title: track.title,
  artists: track.artists.map((artist) => artist.name),
  album: track.album?.title,
  durationMs: track.durationMs,
  artworkUrl: track.artwork?.items[0]?.url,
  source: { provider: track.source.provider, id: track.source.id },
});

export const fromJamTrack = (track: JamTrack): Track => ({
  title: track.title,
  artists: track.artists.map((name) => ({ name, roles: [] })),
  durationMs: track.durationMs,
  artwork: track.artworkUrl
    ? { items: [{ url: track.artworkUrl, purpose: 'cover' }] }
    : undefined,
  source: track.source,
});
