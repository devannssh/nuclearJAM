import { useNavigate } from '@tanstack/react-router';
import {
  ListMusicIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
} from 'lucide-react';
import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { Badge, Button, CopyButton, Tabs } from '@nuclearplayer/ui';

import { useCurrentQueueItem } from '../../../hooks/useCurrentQueueItem';
import { useCrossJamStore } from '../../../stores/crossJamStore';
import { LyricsForTrack } from '../../Lyrics/components/LyricsForTrack';
import { useJamMembership } from '../hooks/useJamMembership';
import { ChatPanel } from './ChatPanel';
import { ListenerList } from './ListenerList';
import { NowPlaying } from './NowPlaying';
import { QueueList } from './QueueList';
import { RoomSettingsDialog } from './RoomSettingsDialog';

export const JamRoom: FC = () => {
  const { t } = useTranslation('crossJam');
  const navigate = useNavigate();
  const room = useCrossJamStore((state) => state.room);
  const currentItem = useCurrentQueueItem();
  const { isHost } = useJamMembership();
  const [selectedTab, setSelectedTab] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  if (!room) {
    return null;
  }

  return (
    <div
      data-testid="jam-room"
      className="flex flex-1 gap-4 overflow-hidden p-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-2xl font-bold" data-testid="room-title">
            {room.name}
          </h2>
          {room.genres.map((genre) => (
            <Badge key={genre} variant="pill" color="secondary">
              {genre}
            </Badge>
          ))}
          {room.inviteCode && (
            <span className="flex items-center gap-1 text-sm">
              {t('room.inviteCode')}:{' '}
              <code data-testid="room-invite-code">{room.inviteCode}</code>
              <CopyButton text={room.inviteCode} />
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void navigate({ to: '/search' })}
              data-testid="add-songs-button"
            >
              <PlusIcon size={16} />
              {t('room.addSongs')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => useCrossJamStore.getState().requestRecap()}
              data-testid="recap-button"
            >
              <ListMusicIcon size={16} />
              {t('room.recap')}
            </Button>
            {isHost && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsSettingsOpen(true)}
                data-testid="room-settings-button"
              >
                <SettingsIcon size={16} />
                {t('room.settings')}
              </Button>
            )}
            <Button
              size="sm"
              intent="danger"
              onClick={() => useCrossJamStore.getState().leaveRoom()}
              data-testid="leave-room-button"
            >
              <LogOutIcon size={16} />
              {t('room.leave')}
            </Button>
          </div>
        </header>

        <NowPlaying room={room} />

        <Tabs
          selectedIndex={selectedTab}
          onChange={setSelectedTab}
          className="flex flex-1 flex-col overflow-hidden"
          panelsClassName="flex-1 overflow-hidden"
          panelClassName="flex flex-1 overflow-hidden pt-2"
          items={[
            {
              id: 'queue',
              label: t('room.queue'),
              content: <QueueList room={room} />,
            },
            {
              id: 'listeners',
              label: `${t('room.listeners')} (${room.members.length})`,
              content: <ListenerList room={room} />,
            },
            {
              id: 'lyrics',
              label: t('room.lyrics'),
              content: (
                <div className="flex flex-1 flex-col overflow-hidden">
                  <LyricsForTrack
                    key={currentItem?.id}
                    currentItem={currentItem}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>

      <aside className="flex w-80 shrink-0 flex-col overflow-hidden">
        <ChatPanel />
      </aside>

      {isHost && (
        <RoomSettingsDialog
          key={isSettingsOpen ? 'open' : 'closed'}
          room={room}
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};
