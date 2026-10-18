import { FC } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { computeTasteMatch, type JamRoomState } from '@nuclearplayer/model';
import { Badge, Button } from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';
import { useJamMembership } from '../hooks/useJamMembership';

export const ListenerList: FC<{ room: JamRoomState }> = ({ room }) => {
  const { t } = useTranslation('crossJam');
  const { userId, member: me, isHost, isController } = useJamMembership();
  const myGenres = useCrossJamStore((state) => state.profile?.genres ?? []);
  const store = useCrossJamStore.getState;

  return (
    <ul
      data-testid="listener-list"
      className="flex flex-col gap-2 overflow-y-auto"
    >
      {room.members.map((member) => {
        const isMe = member.userId === userId;
        const canModerate =
          !isMe &&
          member.role !== 'host' &&
          (isHost || (isController && member.role === 'member'));
        return (
          <li
            key={member.userId}
            data-testid="listener-row"
            className="surface-background border-border flex flex-wrap items-center gap-2 rounded-md border-(length:--border-width) p-2"
          >
            <span className="font-semibold">{member.displayName}</span>
            {member.role === 'host' && (
              <Badge variant="pill" color="purple">
                {t('room.host')}
              </Badge>
            )}
            {member.role === 'cohost' && (
              <Badge variant="pill" color="blue">
                {t('room.cohost')}
              </Badge>
            )}
            {!member.connected && (
              <span className="text-foreground/70 text-sm">
                {t('room.disconnected')}
              </span>
            )}
            {member.muted && (
              <span className="text-foreground/70 text-sm">
                {t('room.muted')}
              </span>
            )}
            {!isMe && (
              <span className="text-foreground/70 ml-auto text-sm">
                {t('rooms.match', {
                  percent: computeTasteMatch(myGenres, member.genres, []),
                })}
              </span>
            )}
            {canModerate && me && (
              <div className="flex w-full flex-wrap gap-1">
                {isHost && (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() =>
                      store().setRole(
                        member.userId,
                        member.role === 'cohost' ? 'member' : 'cohost',
                      )
                    }
                    data-testid="toggle-cohost"
                  >
                    {member.role === 'cohost'
                      ? t('room.removeCohost')
                      : t('room.makeCohost')}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => store().mute(member.userId, !member.muted)}
                  data-testid="toggle-mute"
                >
                  {member.muted ? t('room.unmute') : t('room.mute')}
                </Button>
                <Button
                  size="xs"
                  intent="danger"
                  onClick={() => store().kick(member.userId)}
                  data-testid="kick-button"
                >
                  {t('room.kick')}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};
