import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import type {
  JamChatMessage,
  JamEvent,
  JamMember,
  JamQueueItem,
  JamRecap,
  JamRole,
  JamRoomState,
  JamRoomSummary,
  JamServerMessage,
} from '@nuclearplayer/model';

import App from '../../App';
import { routeTree } from '../../routeTree.gen';
import { jamClient } from '../../services/crossJam/jamClient';
import { useCrossJamStore } from '../../stores/crossJamStore';
import { useQueueStore } from '../../stores/queueStore';
import { useSettingsStore } from '../../stores/settingsStore';

const user = userEvent.setup();

const SERVER_URL_SETTING = 'core.crossJam.serverUrl';
const ME = 'user-me';

export const jamQueueItem = (
  id: string,
  overrides: Partial<JamQueueItem> = {},
): JamQueueItem => ({
  id,
  track: {
    title: `Song ${id}`,
    artists: ['Artist'],
    source: { provider: 'p', id },
  },
  addedBy: 'user-other',
  addedByName: 'Alex',
  addedAt: 1000,
  votes: [],
  ...overrides,
});

export const jamMember = (
  userId: string,
  role: JamRole,
  overrides: Partial<JamMember> = {},
): JamMember => ({
  userId,
  displayName: userId === ME ? 'Me' : `Name ${userId}`,
  genres: [],
  role,
  muted: false,
  connected: true,
  joinedAt: 0,
  ...overrides,
});

export const jamRoom = (
  role: JamRole,
  overrides: Partial<JamRoomState> = {},
): JamRoomState => ({
  id: 'room-1',
  name: 'Late Night',
  genres: ['house'],
  privacy: 'public',
  capacity: 10,
  skipMode: 'anyone',
  inviteCode: null,
  hostId: role === 'host' ? ME : 'user-host',
  members: [
    jamMember(ME, role),
    ...(role === 'host' ? [] : [jamMember('user-host', 'host')]),
    jamMember('user-guest', 'member'),
  ],
  current: jamQueueItem('a'),
  queue: [jamQueueItem('b'), jamQueueItem('c')],
  playback: { playing: true, positionMs: 0, updatedAt: Date.now() },
  skipVotes: [],
  eventId: null,
  createdAt: 0,
  ...overrides,
});

export const roomSummary = (
  overrides: Partial<JamRoomSummary> = {},
): JamRoomSummary => ({
  id: 'room-1',
  name: 'Late Night',
  genres: ['house'],
  privacy: 'public',
  capacity: 10,
  memberCount: 3,
  hostName: 'Alex',
  nowPlaying: null,
  match: 80,
  full: false,
  ...overrides,
});

export const chatMessage = (
  overrides: Partial<JamChatMessage> = {},
): JamChatMessage => ({
  id: 'message-1',
  kind: 'user',
  userId: 'user-guest',
  displayName: 'Guest',
  text: 'hello there',
  at: 1,
  ...overrides,
});

export const jamEvent = (overrides: Partial<JamEvent> = {}): JamEvent => ({
  id: 'event-1',
  title: 'Friday Funk',
  description: 'Bring the groove',
  hostId: 'user-host',
  hostName: 'Alex',
  startsAt: Date.parse('2026-07-11T20:00:00Z'),
  genres: ['funk'],
  privacy: 'public',
  capacity: 20,
  skipMode: 'vote',
  rsvps: ['user-host'],
  status: 'scheduled',
  roomId: null,
  ...overrides,
});

export const jamRecap = (overrides: Partial<JamRecap> = {}): JamRecap => ({
  roomName: 'Late Night',
  durationMs: 25 * 60 * 1000,
  tracksPlayed: 3,
  mostAdded: [
    {
      track: jamQueueItem('a').track,
      count: 2,
    },
  ],
  mostSkipped: [],
  topContributor: { userId: 'user-guest', displayName: 'Guest', added: 4 },
  history: [
    {
      track: jamQueueItem('a').track,
      addedByName: 'Alex',
      skipped: false,
      playedAt: 1,
    },
    {
      track: jamQueueItem('b').track,
      addedByName: 'Alex',
      skipped: true,
      playedAt: 2,
    },
  ],
  ...overrides,
});

export const CrossJamWrapper = {
  sendSpy: undefined as ReturnType<typeof vi.spyOn> | undefined,

  reset() {
    vi.spyOn(jamClient, 'connect').mockImplementation(() => undefined);
    vi.spyOn(jamClient, 'disconnect').mockImplementation(() => undefined);
    this.sendSpy = vi.spyOn(jamClient, 'send').mockReturnValue(true);
    useSettingsStore.setState({ values: {} });
    useQueueStore.setState({ items: [], currentIndex: 0 });
    useCrossJamStore.setState({
      profile: null,
      status: 'connected',
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
    });
  },

  configure(options: { displayName?: string; genres?: string[] } = {}) {
    useSettingsStore.setState((state) => ({
      values: {
        ...state.values,
        [SERVER_URL_SETTING]: 'ws://localhost:4180/jam',
      },
    }));
    useCrossJamStore.setState({
      profile: {
        userId: ME,
        secret: 'secret-1234567890',
        displayName: options.displayName ?? 'Me',
        genres: options.genres ?? ['house'],
      },
    });
  },

  setRooms(rooms: JamRoomSummary[]) {
    useCrossJamStore.setState({ rooms });
  },

  setRoom(room: JamRoomState, chat: JamChatMessage[] = []) {
    useCrossJamStore.setState({ room, chat });
  },

  emit(message: JamServerMessage) {
    useCrossJamStore.getState().handleMessage(message);
  },

  get sentMessages() {
    return (this.sendSpy?.mock.calls ?? []).map(([message]) => message);
  },

  clearSent() {
    this.sendSpy?.mockClear();
  },

  async mount() {
    const history = createMemoryHistory({ initialEntries: ['/crossjam'] });
    const router = createRouter({ routeTree, history });
    const component = render(<App routerProp={router} />);
    await screen.findByTestId('crossjam-view');
    return component;
  },

  async openTab(name: string) {
    await user.click(screen.getByRole('tab', { name }));
  },

  async click(testId: string) {
    await user.click(await screen.findByTestId(testId));
  },

  async type(testId: string, text: string) {
    await user.type(await screen.findByTestId(testId), text);
  },

  within(testId: string) {
    return within(screen.getByTestId(testId));
  },

  async waitForSent(type: string) {
    await waitFor(() => {
      expect(this.sentMessages.some((message) => message.type === type)).toBe(
        true,
      );
    });
  },

  lastSent(type: string) {
    return [...this.sentMessages]
      .reverse()
      .find((message) => message.type === type);
  },
};
