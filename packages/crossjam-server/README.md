# Cross Jam server

Relay server for Nuclear's Cross Jam feature. Players connect to it over WebSocket to find rooms, listen together, chat, and keep a friends list. The server never touches audio. It only keeps track of the room: who is in it, what is queued, and where playback is. Each player resolves and streams the song itself.

## Running it

```bash
pnpm install
pnpm --filter @nuclearplayer/crossjam-server start
```

Then, in Nuclear, open Cross Jam and enter `ws://localhost:4180/jam` as the server address (or set it under Settings → Integrations).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4180` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `CROSSJAM_DATA_FILE` | `./data/crossjam.json` | Where users, friendships and events are saved |

`GET /health` returns `{ "ok": true, "rooms": <count> }`.

Development: `pnpm --filter @nuclearplayer/crossjam-server dev` (restarts on changes). Tests: `pnpm --filter @nuclearplayer/crossjam-server test`.

## What it does

- **Rooms:** public (listed, ranked by genre match) or invite-code only. Names are unique among live rooms. Capacity 2–50.
- **Host handoff:** when the host leaves, a co-host takes over if there is one, otherwise the member who has been in the room longest.
- **Closing:** a room with nobody in it stays joinable for 2 minutes, then is deleted. The first person to join an empty room becomes host.
- **Reconnects:** a dropped connection keeps its seat for 15 seconds.
- **Queue:** anyone can add songs (no duplicates; regular members can have 10 queued at a time, hosts and co-hosts have no limit). Upcoming songs are ordered by upvotes, then by when they were added.
- **Skipping:** per room: anyone, majority vote, or host and co-hosts only. Hosts and co-hosts can always skip.
- **Playback:** the host (or a co-host) reports play, pause, seek and a heartbeat. The server keeps `{ playing, positionMs, updatedAt }` and clients extrapolate from it, correcting drift locally. If a track's duration is known, the server also advances 8 seconds after it should have ended, in case nobody reported it.
- **Moderation:** mute, kick (10-minute ban from rejoining), co-host promotion. Chat and reactions are rate limited.
- **Friends and events:** friend codes, mutual requests, presence, and scheduled events with RSVPs.

Genre matching uses the shared `computeTasteMatch` in `@nuclearplayer/model`. The server ranks rooms for each requester using their saved genres and the genres of the people currently in the room.

## Things to know before putting it on the internet

- **No TLS.** The server speaks plain `ws://`. For anything public, put it behind a reverse proxy that terminates TLS (so players use `wss://`).
- **Light identity.** Each install generates a user id and a secret. The server stores only a hash of the secret and rejects a user id presented with the wrong secret. There are no accounts, so losing the app data means losing the identity, friends included.
- **Single instance, in memory.** Rooms live in memory and are lost on restart. Users, friendships and events are saved to the data file. You cannot run several instances behind a load balancer without sharing state.
- **Limited moderation.** There is mute and kick, but no report or block flow, no profanity filter, and no server-side audit log. Public rooms with strangers will need more than this.
- **Names and chat are unfiltered.** Room names, display names and chat text are length-limited but not otherwise filtered.
- **Messages from the server are not schema-validated by the player.** The player checks the shape loosely. Only run a server you trust.

## Protocol

JSON over WebSocket at `/jam`. Message types and validation live in `packages/model/src/crossjam.ts` (`jamClientMessageSchema` for client messages, `JamServerMessage` for server messages). The first message must be `hello`.
