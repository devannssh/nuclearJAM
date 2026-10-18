import { SendIcon } from 'lucide-react';
import { FC, useEffect, useRef, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { JAM_LIMITS } from '@nuclearplayer/model';
import { Button, Input } from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';
import { useJamMembership } from '../hooks/useJamMembership';

export const ChatPanel: FC = () => {
  const { t } = useTranslation('crossJam');
  const chat = useCrossJamStore((state) => state.chat);
  const { member } = useJamMembership();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.length]);

  const send = () => {
    const text = draft.trim();
    if (text) {
      useCrossJamStore.getState().sendChat(text);
      setDraft('');
    }
  };

  return (
    <section
      data-testid="chat-panel"
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      <h3 className="font-bold">{t('room.chat')}</h3>
      <div
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
        data-testid="chat-messages"
      >
        {chat.map((message) =>
          message.kind === 'system' ? (
            <p
              key={message.id}
              className="text-foreground/60 text-sm italic"
              data-testid="chat-system"
            >
              {t(`system.${message.text}`, { name: message.displayName })}
            </p>
          ) : (
            <p
              key={message.id}
              className="text-sm break-words"
              data-testid="chat-message"
            >
              <span className="font-bold">{message.displayName}</span>{' '}
              {message.text}
            </p>
          ),
        )}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2">
        <Input
          placeholder={t('room.chatPlaceholder')}
          value={draft}
          maxLength={JAM_LIMITS.chatMax}
          disabled={member?.muted}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              send();
            }
          }}
          data-testid="chat-input"
        />
        <Button
          size="icon"
          aria-label={t('room.send')}
          disabled={!draft.trim() || member?.muted}
          onClick={send}
          data-testid="chat-send"
        >
          <SendIcon size={16} />
        </Button>
      </div>
    </section>
  );
};
