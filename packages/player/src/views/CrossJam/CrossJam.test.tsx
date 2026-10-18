import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { TasteProvider } from '@nuclearplayer/plugin-sdk';

import { providersHost } from '../../services/providersHost';
import { useCrossJamStore } from '../../stores/crossJamStore';
import { usePlaylistStore } from '../../stores/playlistStore';
import {
  chatMessage,
  CrossJamWrapper,
  jamEvent,
  jamMember,
  jamQueueItem,
  jamRecap,
  jamRoom,
  roomSummary,
} from './CrossJam.test-wrapper';

const user = userEvent.setup();

describe('Cross Jam view', () => {
  beforeEach(() => {
    CrossJamWrapper.reset();
  });

  describe('first-time setup', () => {
    it('asks for a name and server before showing anything else', async () => {
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('crossjam-setup')).toBeInTheDocument();
      expect(screen.getByTestId('setup-continue')).toBeDisabled();
    });

    it('saves the profile and moves on to the lobby', async () => {
      useCrossJamStore.setState({
        profile: {
          userId: ME_ID,
          secret: 'secret-1234567890',
          displayName: '',
          genres: [],
        },
      });
      await CrossJamWrapper.mount();

      await CrossJamWrapper.type('setup-display-name', 'Sam');
      await CrossJamWrapper.type('setup-server-url', 'ws://localhost:4180/jam');
      await user.click(screen.getByRole('checkbox', { name: 'house' }));
      await CrossJamWrapper.click('setup-continue');

      expect(await screen.findByTestId('room-browser')).toBeInTheDocument();
      expect(useCrossJamStore.getState().profile).toMatchObject({
        displayName: 'Sam',
        genres: ['house'],
      });
    });
  });

  describe('lobby', () => {
    beforeEach(() => {
      CrossJamWrapper.configure();
    });

    it('lists rooms in the order the server ranked them, with match percentages', async () => {
      CrossJamWrapper.setRooms([
        roomSummary({ id: 'r1', name: 'Club Night', match: 92 }),
        roomSummary({ id: 'r2', name: 'Riff Lounge', match: 14 }),
      ]);
      await CrossJamWrapper.mount();

      const cards = await screen.findAllByTestId('room-card');
      expect(
        cards.map((card) => card.querySelector('h3')?.textContent),
      ).toEqual(['Club Night', 'Riff Lounge']);
      expect(
        screen.getAllByTestId('room-match').map((badge) => badge.textContent),
      ).toEqual(['92% match', '14% match']);
    });

    it('shows an empty state with a way to start a room', async () => {
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('rooms-empty')).toBeInTheDocument();
    });

    it('joins a room from its card', async () => {
      CrossJamWrapper.setRooms([roomSummary({ id: 'r1' })]);
      await CrossJamWrapper.mount();

      await CrossJamWrapper.click('join-room-button');

      expect(CrossJamWrapper.lastSent('room.join')).toEqual({
        type: 'room.join',
        roomId: 'r1',
      });
    });

    it('does not let you join a full room', async () => {
      CrossJamWrapper.setRooms([roomSummary({ full: true })]);
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('join-room-button')).toBeDisabled();
    });

    it('joins with an invite code', async () => {
      await CrossJamWrapper.mount();

      await CrossJamWrapper.type('invite-code-input', 'ABC123');
      await CrossJamWrapper.click('join-with-code-button');

      expect(CrossJamWrapper.lastSent('room.join')).toEqual({
        type: 'room.join',
        inviteCode: 'ABC123',
      });
    });

    it('creates a room with the chosen name and genres', async () => {
      await CrossJamWrapper.mount();

      await CrossJamWrapper.click('create-room-button');
      await CrossJamWrapper.type('room-name-input', 'Sunday Chill');
      await user.click(
        within(screen.getByTestId('room-genre-picker')).getByRole('checkbox', {
          name: 'lo-fi',
        }),
      );
      await CrossJamWrapper.click('create-room-submit');

      expect(CrossJamWrapper.lastSent('room.create')).toEqual({
        type: 'room.create',
        settings: {
          name: 'Sunday Chill',
          genres: ['lo-fi'],
          privacy: 'public',
          capacity: 10,
          skipMode: 'anyone',
        },
      });
    });

    it('will not create a room without a name', async () => {
      await CrossJamWrapper.mount();

      await CrossJamWrapper.click('create-room-button');

      expect(await screen.findByTestId('create-room-submit')).toBeDisabled();
    });

    it('shows a friendly message for server errors', async () => {
      await CrossJamWrapper.mount();

      CrossJamWrapper.emit({ type: 'error', code: 'room_full', message: 'x' });

      expect(await screen.findByText('That room is full.')).toBeInTheDocument();
    });
  });

  describe('friends and events', () => {
    beforeEach(() => {
      CrossJamWrapper.configure();
    });

    it('shows friends and their rooms, and joins them', async () => {
      useCrossJamStore.setState({
        friendCode: 'ABCDEFGH',
        friends: [
          {
            userId: 'f1',
            displayName: 'Robin',
            status: 'online',
            roomId: 'room-9',
            roomName: 'Robin Radio',
          },
        ],
      });
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Friends');

      expect(screen.getByTestId('friends-own-code')).toHaveTextContent(
        'ABCDEFGH',
      );
      expect(screen.getByTestId('friend-row')).toHaveTextContent(
        'In “Robin Radio”',
      );
      await user.click(screen.getByRole('button', { name: 'Join' }));

      expect(CrossJamWrapper.lastSent('room.join')).toEqual({
        type: 'room.join',
        roomId: 'room-9',
      });
    });

    it('sends a friend request by code', async () => {
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Friends');

      await CrossJamWrapper.type('friend-code-input', 'WXYZ2345');
      await CrossJamWrapper.click('send-friend-request');

      expect(CrossJamWrapper.lastSent('friends.request')).toEqual({
        type: 'friends.request',
        friendCode: 'WXYZ2345',
      });
    });

    it('accepts an incoming friend request', async () => {
      useCrossJamStore.setState({
        incomingRequests: [{ userId: 'f2', displayName: 'Casey' }],
      });
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Friends (1)');

      await user.click(screen.getByRole('button', { name: 'Accept' }));

      expect(CrossJamWrapper.lastSent('friends.respond')).toEqual({
        type: 'friends.respond',
        userId: 'f2',
        accept: true,
      });
    });

    it('lets people RSVP to someone else’s event', async () => {
      useCrossJamStore.setState({ events: [jamEvent()] });
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Events');

      expect(await screen.findByTestId('event-row')).toHaveTextContent(
        'Friday Funk',
      );
      await CrossJamWrapper.click('rsvp-button');

      expect(CrossJamWrapper.lastSent('events.rsvp')).toEqual({
        type: 'events.rsvp',
        eventId: 'event-1',
        going: true,
      });
    });

    it('lets the host start their own event', async () => {
      useCrossJamStore.setState({
        events: [jamEvent({ hostId: 'user-me', rsvps: ['user-me'] })],
      });
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Events');

      await CrossJamWrapper.click('start-event-button');

      expect(CrossJamWrapper.lastSent('events.start')).toEqual({
        type: 'events.start',
        eventId: 'event-1',
      });
    });
  });

  describe('inside a room', () => {
    beforeEach(() => {
      CrossJamWrapper.configure();
    });

    it('shows the room, what is playing and what is queued', async () => {
      CrossJamWrapper.setRoom(jamRoom('member'));
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('room-title')).toHaveTextContent(
        'Late Night',
      );
      expect(screen.getByTestId('jam-now-playing-title')).toHaveTextContent(
        'Song a',
      );
      expect(screen.getAllByTestId('queue-row')).toHaveLength(2);
    });

    it('says so when nothing is playing', async () => {
      CrossJamWrapper.setRoom(jamRoom('member', { current: null, queue: [] }));
      await CrossJamWrapper.mount();

      expect(
        await screen.findByTestId('jam-nothing-playing'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('skip-button')).not.toBeInTheDocument();
    });

    it('upvotes a queued song', async () => {
      CrossJamWrapper.setRoom(
        jamRoom('member', {
          queue: [jamQueueItem('b', { votes: ['user-guest', 'user-host'] })],
        }),
      );
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('vote-count')).toHaveTextContent('2');
      await CrossJamWrapper.click('upvote-button');

      expect(CrossJamWrapper.lastSent('queue.vote')).toEqual({
        type: 'queue.vote',
        itemId: 'b',
      });
    });

    it('lets only the adder or a moderator remove a queued song', async () => {
      CrossJamWrapper.setRoom(
        jamRoom('member', {
          queue: [
            jamQueueItem('b'),
            jamQueueItem('c', { addedBy: 'user-me', addedByName: 'Me' }),
          ],
        }),
      );
      await CrossJamWrapper.mount();

      const removeButtons = await screen.findAllByTestId('remove-queue-item');
      expect(removeButtons).toHaveLength(1);
      await user.click(removeButtons[0]);

      expect(CrossJamWrapper.lastSent('queue.remove')).toEqual({
        type: 'queue.remove',
        itemId: 'c',
      });
    });

    it('lets the host remove anything from the queue', async () => {
      CrossJamWrapper.setRoom(jamRoom('host'));
      await CrossJamWrapper.mount();

      expect(await screen.findAllByTestId('remove-queue-item')).toHaveLength(2);
    });

    it('skips directly when anyone may skip', async () => {
      CrossJamWrapper.setRoom(jamRoom('member', { skipMode: 'anyone' }));
      await CrossJamWrapper.mount();

      await CrossJamWrapper.click('skip-button');

      expect(CrossJamWrapper.lastSent('playback.skip')).toEqual({
        type: 'playback.skip',
      });
    });

    it('offers a vote and shows progress in vote mode', async () => {
      CrossJamWrapper.setRoom(
        jamRoom('member', { skipMode: 'vote', skipVotes: ['user-guest'] }),
      );
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('skip-button')).toHaveTextContent(
        'Vote to skip',
      );
      expect(screen.getByTestId('skip-votes')).toHaveTextContent(
        '1 of 2 votes to skip',
      );
    });

    it('disables skipping for non-hosts in host-only rooms', async () => {
      CrossJamWrapper.setRoom(jamRoom('member', { skipMode: 'host' }));
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('skip-button')).toBeDisabled();
    });

    it('lets the host skip in host-only rooms', async () => {
      CrossJamWrapper.setRoom(jamRoom('host', { skipMode: 'host' }));
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('skip-button')).toBeEnabled();
    });

    it('sends emoji reactions', async () => {
      CrossJamWrapper.setRoom(jamRoom('member'));
      await CrossJamWrapper.mount();

      await CrossJamWrapper.click('reaction-🔥');

      expect(CrossJamWrapper.lastSent('reaction.send')).toEqual({
        type: 'reaction.send',
        emoji: '🔥',
      });
    });

    it('shows chat and join notices, and sends messages', async () => {
      CrossJamWrapper.setRoom(jamRoom('member'), [
        chatMessage(),
        chatMessage({
          id: 'system-1',
          kind: 'system',
          text: 'joined',
          displayName: 'Guest',
        }),
      ]);
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('chat-message')).toHaveTextContent(
        'Guest hello there',
      );
      expect(screen.getByTestId('chat-system')).toHaveTextContent(
        'Guest joined',
      );

      await CrossJamWrapper.type('chat-input', 'nice pick');
      await CrossJamWrapper.click('chat-send');

      expect(CrossJamWrapper.lastSent('chat.send')).toEqual({
        type: 'chat.send',
        text: 'nice pick',
      });
      expect(screen.getByTestId('chat-input')).toHaveValue('');
    });

    it('blocks chatting while muted', async () => {
      CrossJamWrapper.setRoom(
        jamRoom('member', {
          members: [
            jamMember('user-me', 'member', { muted: true }),
            jamMember('user-host', 'host'),
          ],
        }),
      );
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('chat-input')).toBeDisabled();
    });

    it('lists listeners and lets the host moderate them', async () => {
      CrossJamWrapper.setRoom(jamRoom('host'));
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Listeners (2)');

      expect(screen.getAllByTestId('listener-row')).toHaveLength(2);
      await CrossJamWrapper.click('toggle-cohost');
      expect(CrossJamWrapper.lastSent('member.setRole')).toEqual({
        type: 'member.setRole',
        userId: 'user-guest',
        role: 'cohost',
      });

      await CrossJamWrapper.click('toggle-mute');
      expect(CrossJamWrapper.lastSent('member.mute')).toEqual({
        type: 'member.mute',
        userId: 'user-guest',
        muted: true,
      });

      await CrossJamWrapper.click('kick-button');
      expect(CrossJamWrapper.lastSent('member.kick')).toEqual({
        type: 'member.kick',
        userId: 'user-guest',
      });
    });

    it('gives regular listeners no moderation controls', async () => {
      CrossJamWrapper.setRoom(jamRoom('member'));
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Listeners (3)');

      expect(screen.queryByTestId('kick-button')).not.toBeInTheDocument();
    });

    it('shows the invite code for invite-only rooms', async () => {
      CrossJamWrapper.setRoom(
        jamRoom('member', { privacy: 'invite', inviteCode: 'QWERTY' }),
      );
      await CrossJamWrapper.mount();

      expect(await screen.findByTestId('room-invite-code')).toHaveTextContent(
        'QWERTY',
      );
    });

    it('lets only the host open room settings and save them', async () => {
      CrossJamWrapper.setRoom(jamRoom('member'));
      const { unmount } = await CrossJamWrapper.mount();
      expect(
        screen.queryByTestId('room-settings-button'),
      ).not.toBeInTheDocument();
      unmount();

      CrossJamWrapper.setRoom(jamRoom('host'));
      await CrossJamWrapper.mount();
      await CrossJamWrapper.click('room-settings-button');
      await CrossJamWrapper.click('save-room-settings');

      expect(CrossJamWrapper.lastSent('room.updateSettings')).toEqual({
        type: 'room.updateSettings',
        settings: {
          name: 'Late Night',
          genres: ['house'],
          privacy: 'public',
          capacity: 10,
          skipMode: 'anyone',
        },
      });
    });

    it('leaves the room', async () => {
      CrossJamWrapper.setRoom(jamRoom('member'));
      await CrossJamWrapper.mount();

      await CrossJamWrapper.click('leave-room-button');

      expect(CrossJamWrapper.lastSent('room.leave')).toEqual({
        type: 'room.leave',
      });
    });

    it('goes back to the lobby when the server removes you from the room', async () => {
      CrossJamWrapper.setRoom(jamRoom('member'));
      await CrossJamWrapper.mount();
      await screen.findByTestId('jam-room');

      CrossJamWrapper.emit({
        type: 'room.left',
        reason: 'kicked',
        recap: null,
      });

      expect(await screen.findByTestId('room-browser')).toBeInTheDocument();
      expect(
        await screen.findByText('You were removed from the room.'),
      ).toBeInTheDocument();
    });
  });

  describe('importing genres from a taste provider', () => {
    const registerTasteProvider = (fetchGenres: TasteProvider['fetchGenres']) =>
      providersHost.register({
        id: 'lastfm',
        kind: 'taste',
        name: 'Last.fm',
        fetchGenres,
      } satisfies TasteProvider);

    beforeEach(() => {
      CrossJamWrapper.configure({ genres: [] });
    });

    afterEach(() => {
      providersHost.clear();
    });

    it('offers nothing when no taste plugin is installed', async () => {
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Profile');

      expect(screen.queryByTestId('taste-import')).not.toBeInTheDocument();
    });

    it('fills in genres from the plugin', async () => {
      registerTasteProvider(async () => ['Jazz', 'Soul']);
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Profile');

      await CrossJamWrapper.click('taste-import-lastfm');

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: 'jazz' })).toBeChecked();
      });
      expect(screen.getByRole('checkbox', { name: 'soul' })).toBeChecked();
    });

    it('tells the user when the import fails', async () => {
      registerTasteProvider(async () => {
        throw new Error('network down');
      });
      await CrossJamWrapper.mount();
      await CrossJamWrapper.openTab('Profile');

      await CrossJamWrapper.click('taste-import-lastfm');

      expect(
        await screen.findByText("Couldn't import genres"),
      ).toBeInTheDocument();
    });
  });

  describe('session recap', () => {
    beforeEach(() => {
      CrossJamWrapper.configure();
    });

    it('asks the server for a recap on request', async () => {
      CrossJamWrapper.setRoom(jamRoom('member'));
      await CrossJamWrapper.mount();

      await CrossJamWrapper.click('recap-button');

      expect(CrossJamWrapper.lastSent('room.recap')).toEqual({
        type: 'room.recap',
      });
    });

    it('shows the recap after leaving a room', async () => {
      await CrossJamWrapper.mount();

      CrossJamWrapper.emit({
        type: 'room.left',
        reason: 'left',
        recap: jamRecap(),
      });

      expect(
        await screen.findByTestId('recap-tracks-played'),
      ).toHaveTextContent('3');
      expect(screen.getByTestId('recap-top-contributor')).toHaveTextContent(
        'Guest (4 added)',
      );
      expect(CrossJamWrapper.within('recap-most-added')).toBeDefined();
      expect(screen.getByTestId('recap-most-added')).toHaveTextContent(
        'Song a',
      );
      expect(screen.getByTestId('recap-most-skipped')).toHaveTextContent(
        'Nothing yet',
      );
    });

    it('saves only the songs that were actually played as a playlist', async () => {
      const createPlaylist = vi.fn().mockResolvedValue('playlist-1');
      const addTracks = vi.fn().mockResolvedValue([]);
      usePlaylistStore.setState({ createPlaylist, addTracks });
      await CrossJamWrapper.mount();
      CrossJamWrapper.emit({
        type: 'room.left',
        reason: 'left',
        recap: jamRecap(),
      });

      await CrossJamWrapper.click('save-playlist-button');

      await waitFor(() => expect(addTracks).toHaveBeenCalledTimes(1));
      expect(createPlaylist).toHaveBeenCalledWith(
        expect.stringContaining('Late Night'),
      );
      const [playlistId, tracks] = addTracks.mock.calls[0];
      expect(playlistId).toBe('playlist-1');
      expect(tracks.map((track: { title: string }) => track.title)).toEqual([
        'Song a',
      ]);
    });

    it('disables saving when nothing was played', async () => {
      await CrossJamWrapper.mount();

      CrossJamWrapper.emit({
        type: 'room.left',
        reason: 'left',
        recap: jamRecap({ history: [], tracksPlayed: 0 }),
      });

      expect(await screen.findByTestId('save-playlist-button')).toBeDisabled();
    });

    it('closes the recap', async () => {
      await CrossJamWrapper.mount();
      CrossJamWrapper.emit({
        type: 'room.left',
        reason: 'left',
        recap: jamRecap(),
      });

      await CrossJamWrapper.click('recap-close');

      await waitFor(() => {
        expect(screen.queryByTestId('recap-content')).not.toBeInTheDocument();
      });
    });
  });
});

const ME_ID = 'user-me';
