import { SkipForwardIcon } from 'lucide-react';
import { FC } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import {
  JAM_REACTIONS,
  jamSkipThreshold,
  type JamRoomState,
} from '@nuclearplayer/model';
import { Button } from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';
import { useJamMembership } from '../hooks/useJamMembership';

export const NowPlaying: FC<{ room: JamRoomState }> = ({ room }) => {
  const { t } = useTranslation('crossJam');
  const reactions = useCrossJamStore((state) => state.reactions);
  const { member, isController } = useJamMembership();
  const { current } = room;

  const connectedCount = room.members.filter(
    (candidate) => candidate.connected,
  ).length;
  const isVoteMode = room.skipMode === 'vote' && !isController;
  const canSkip =
    !!current && !member?.muted && (isController || room.skipMode !== 'host');

  return (
    <section
      data-testid="jam-now-playing"
      className="surface-primary border-border shadow-shadow flex flex-col gap-3 rounded-md border-(length:--border-width) p-4"
    >
      <span className="text-sm font-semibold uppercase">
        {t('room.nowPlaying')}
      </span>
      {current ? (
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              data-testid="jam-now-playing-title"
              className="truncate text-xl font-bold"
            >
              {current.track.title}
            </span>
            <span className="truncate">{current.track.artists.join(', ')}</span>
            <span className="text-sm opacity-70">
              {t('room.addedBy', { name: current.addedByName })}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="secondary"
              disabled={!canSkip}
              onClick={() => useCrossJamStore.getState().skip()}
              data-testid="skip-button"
            >
              <SkipForwardIcon size={16} />
              {isVoteMode ? t('room.voteSkip') : t('room.skip')}
            </Button>
            {room.skipMode === 'vote' && room.skipVotes.length > 0 && (
              <span data-testid="skip-votes" className="text-sm">
                {t('room.skipVotes', {
                  count: room.skipVotes.length,
                  needed: jamSkipThreshold(connectedCount),
                })}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p data-testid="jam-nothing-playing">{t('room.nothingPlaying')}</p>
      )}

      <div
        className="flex flex-wrap items-center gap-2"
        aria-label={t('room.reactions')}
      >
        {JAM_REACTIONS.map((emoji) => (
          <Button
            key={emoji}
            size="icon-sm"
            variant="secondary"
            disabled={member?.muted}
            onClick={() => useCrossJamStore.getState().react(emoji)}
            data-testid={`reaction-${emoji}`}
          >
            {emoji}
          </Button>
        ))}
      </div>
      <div
        className="flex min-h-6 flex-wrap gap-2"
        data-testid="reaction-bursts"
      >
        {reactions.map((burst) => (
          <span
            key={burst.id}
            className="surface-background border-border rounded-full border px-2 text-sm"
          >
            {burst.emoji} {burst.displayName}
          </span>
        ))}
      </div>
    </section>
  );
};
