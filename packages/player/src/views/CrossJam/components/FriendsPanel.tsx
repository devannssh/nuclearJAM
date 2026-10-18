import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  Input,
} from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';

export const FriendsPanel: FC = () => {
  const { t } = useTranslation('crossJam');
  const friendCode = useCrossJamStore((state) => state.friendCode);
  const friends = useCrossJamStore((state) => state.friends);
  const incoming = useCrossJamStore((state) => state.incomingRequests);
  const outgoing = useCrossJamStore((state) => state.outgoingRequests);
  const [code, setCode] = useState('');

  const sendRequest = () => {
    const trimmed = code.trim();
    if (trimmed) {
      useCrossJamStore.getState().requestFriend(trimmed);
      setCode('');
    }
  };

  return (
    <div
      data-testid="friends-panel"
      className="flex flex-1 flex-col gap-6 overflow-y-auto p-4"
    >
      <div className="flex flex-wrap items-end gap-4">
        {friendCode && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold">
              {t('friends.yourCode')}
            </span>
            <div className="flex items-center gap-2">
              <code data-testid="friends-own-code">{friendCode}</code>
              <CopyButton text={friendCode} />
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Input
            placeholder={t('friends.addPlaceholder')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                sendRequest();
              }
            }}
            data-testid="friend-code-input"
          />
          <Button
            disabled={!code.trim()}
            onClick={sendRequest}
            data-testid="send-friend-request"
          >
            {t('friends.add')}
          </Button>
        </div>
      </div>

      {incoming.length > 0 && (
        <section
          className="flex flex-col gap-2"
          data-testid="incoming-requests"
        >
          <h3 className="font-bold">{t('friends.incoming')}</h3>
          {incoming.map((request) => (
            <div key={request.userId} className="flex items-center gap-2">
              <span className="flex-1">{request.displayName}</span>
              <Button
                size="xs"
                onClick={() =>
                  useCrossJamStore
                    .getState()
                    .respondToFriend(request.userId, true)
                }
              >
                {t('friends.accept')}
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() =>
                  useCrossJamStore
                    .getState()
                    .respondToFriend(request.userId, false)
                }
              >
                {t('friends.decline')}
              </Button>
            </div>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-bold">{t('friends.outgoing')}</h3>
          {outgoing.map((request) => (
            <span key={request.userId}>{request.displayName}</span>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-bold">{t('friends.list')}</h3>
        {friends.length === 0 ? (
          <EmptyState size="sm" title={t('friends.empty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.map((friend) => (
              <li
                key={friend.userId}
                data-testid="friend-row"
                className="flex items-center gap-3"
              >
                <Badge
                  variant="dot"
                  color={friend.status === 'online' ? 'green' : 'secondary'}
                />
                <span className="flex-1">
                  {friend.displayName}
                  <span className="text-foreground/70 ml-2 text-sm">
                    {friend.roomName
                      ? t('friends.inRoom', { room: friend.roomName })
                      : friend.status === 'online'
                        ? t('friends.online')
                        : t('friends.offline')}
                  </span>
                </span>
                {friend.roomId && (
                  <Button
                    size="xs"
                    onClick={() =>
                      useCrossJamStore
                        .getState()
                        .joinRoom({ roomId: friend.roomId as string })
                    }
                  >
                    {t('friends.joinFriend')}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    useCrossJamStore.getState().removeFriend(friend.userId)
                  }
                >
                  {t('friends.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
