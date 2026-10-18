import { PlusIcon, RefreshCwIcon, UsersIcon } from 'lucide-react';
import { FC, useEffect, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import type { JamRoomSummary } from '@nuclearplayer/model';
import { Badge, Button, EmptyState, Input } from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';
import { CreateRoomDialog } from './CreateRoomDialog';

const REFRESH_INTERVAL_MS = 10000;

const RoomCard: FC<{ room: JamRoomSummary }> = ({ room }) => {
  const { t } = useTranslation('crossJam');

  return (
    <li
      data-testid="room-card"
      className="surface-background border-border shadow-shadow flex flex-col gap-3 rounded-md border-(length:--border-width) p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-lg font-bold">{room.name}</h3>
          <span className="text-foreground/70 text-sm">
            {room.hostName
              ? t('rooms.hostedBy', { name: room.hostName })
              : null}
          </span>
        </div>
        <Badge
          variant="pill"
          color={
            room.match >= 60 ? 'green' : room.match > 0 ? 'yellow' : 'secondary'
          }
          data-testid="room-match"
        >
          {t('rooms.match', { percent: room.match })}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-1">
        {room.genres.map((genre) => (
          <Badge key={genre} variant="pill" color="secondary">
            {genre}
          </Badge>
        ))}
      </div>
      <div className="text-foreground/70 text-sm">
        {room.nowPlaying
          ? `${room.nowPlaying.title} · ${room.nowPlaying.artists.join(', ')}`
          : t('rooms.nothingPlaying')}
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-sm">
          <UsersIcon size={16} />
          {t('rooms.listeners', { count: room.memberCount })}
        </span>
        <Button
          size="sm"
          disabled={room.full}
          onClick={() =>
            useCrossJamStore.getState().joinRoom({ roomId: room.id })
          }
          data-testid="join-room-button"
        >
          {room.full ? t('rooms.full') : t('rooms.join')}
        </Button>
      </div>
    </li>
  );
};

export const RoomBrowser: FC = () => {
  const { t } = useTranslation('crossJam');
  const rooms = useCrossJamStore((state) => state.rooms);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    const interval = setInterval(
      () => useCrossJamStore.getState().refreshRooms(),
      REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, []);

  const joinWithCode = () => {
    const code = inviteCode.trim();
    if (code) {
      useCrossJamStore.getState().joinRoom({ inviteCode: code });
      setInviteCode('');
    }
  };

  return (
    <div
      data-testid="room-browser"
      className="flex flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Button
          onClick={() => setIsCreateOpen(true)}
          data-testid="create-room-button"
        >
          <PlusIcon size={16} />
          {t('rooms.create')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => useCrossJamStore.getState().refreshRooms()}
          data-testid="refresh-rooms-button"
        >
          <RefreshCwIcon size={16} />
          {t('rooms.refresh')}
        </Button>
        <div className="ml-auto flex items-end gap-2">
          <Input
            label={t('rooms.joinWithCode')}
            placeholder={t('rooms.codePlaceholder')}
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                joinWithCode();
              }
            }}
            data-testid="invite-code-input"
          />
          <Button
            variant="secondary"
            disabled={!inviteCode.trim()}
            onClick={joinWithCode}
            data-testid="join-with-code-button"
          >
            {t('rooms.join')}
          </Button>
        </div>
      </div>

      {rooms.length === 0 ? (
        <EmptyState
          data-testid="rooms-empty"
          title={t('rooms.empty')}
          action={
            <Button onClick={() => setIsCreateOpen(true)}>
              {t('rooms.create')}
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-foreground/70 text-sm">
            {t('rooms.sortedByMatch')}
          </p>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rooms.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </ul>
        </>
      )}

      <CreateRoomDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </div>
  );
};
