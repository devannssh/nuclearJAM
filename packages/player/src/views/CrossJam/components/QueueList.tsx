import { ArrowBigUpIcon, XIcon } from 'lucide-react';
import { FC } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import type { JamRoomState } from '@nuclearplayer/model';
import { Button, EmptyState } from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';
import { useJamMembership } from '../hooks/useJamMembership';

export const QueueList: FC<{ room: JamRoomState }> = ({ room }) => {
  const { t } = useTranslation('crossJam');
  const { userId, member, isController } = useJamMembership();

  return (
    <div
      data-testid="jam-queue"
      className="flex flex-1 flex-col gap-2 overflow-y-auto"
    >
      <p className="text-foreground/70 text-sm">{t('room.addSongsHint')}</p>
      {room.queue.length === 0 ? (
        <EmptyState size="sm" title={t('room.queueEmpty')} />
      ) : (
        <ol className="flex flex-col gap-2">
          {room.queue.map((item) => {
            const hasVoted = !!userId && item.votes.includes(userId);
            const canRemove = isController || item.addedBy === userId;
            return (
              <li
                key={item.id}
                data-testid="queue-row"
                className="surface-background border-border flex items-center gap-3 rounded-md border-(length:--border-width) p-2"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">
                    {item.track.title}
                  </span>
                  <span className="text-foreground/70 truncate text-sm">
                    {item.track.artists.join(', ')} ·{' '}
                    {t('room.addedBy', { name: item.addedByName })}
                  </span>
                </div>
                <Button
                  size="xs"
                  variant={hasVoted ? 'default' : 'secondary'}
                  disabled={member?.muted}
                  aria-label={t('room.upvote')}
                  onClick={() =>
                    useCrossJamStore.getState().voteQueueItem(item.id)
                  }
                  data-testid="upvote-button"
                >
                  <ArrowBigUpIcon size={16} />
                  <span data-testid="vote-count">{item.votes.length}</span>
                </Button>
                {canRemove && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('room.removeFromQueue')}
                    onClick={() =>
                      useCrossJamStore.getState().removeQueueItem(item.id)
                    }
                    data-testid="remove-queue-item"
                  >
                    <XIcon size={14} />
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
