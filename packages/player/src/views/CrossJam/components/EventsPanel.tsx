import { CalendarPlusIcon } from 'lucide-react';
import { DateTime } from 'luxon';
import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import type { JamEvent, JamRoomSettings } from '@nuclearplayer/model';
import { Badge, Button, Dialog, EmptyState, Input } from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';
import { defaultRoomSettings, RoomSettingsFields } from './RoomSettingsFields';

const DEFAULT_LEAD_MINUTES = 60;

const toLocalInputValue = (millis: number): string =>
  DateTime.fromMillis(millis).toFormat("yyyy-LL-dd'T'HH:mm");

const CreateEventDialog: FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation('crossJam');
  const [settings, setSettings] =
    useState<JamRoomSettings>(defaultRoomSettings);
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(() =>
    toLocalInputValue(Date.now() + DEFAULT_LEAD_MINUTES * 60 * 1000),
  );

  const startsAtMillis = DateTime.fromISO(startsAt).toMillis();
  const isValid =
    settings.name.trim().length > 0 && !Number.isNaN(startsAtMillis);

  const handleSubmit = () => {
    useCrossJamStore.getState().createEvent({
      title: settings.name.trim(),
      description: description.trim() || undefined,
      startsAt: startsAtMillis,
      genres: settings.genres,
      privacy: settings.privacy,
      capacity: settings.capacity,
      skipMode: settings.skipMode,
    });
    setSettings(defaultRoomSettings());
    setDescription('');
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('events.create')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('create.cancel')}
          </Button>
          <Button
            disabled={!isValid}
            onClick={handleSubmit}
            data-testid="create-event-submit"
          >
            {t('events.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label={t('events.title')}
          placeholder={t('events.titlePlaceholder')}
          value={settings.name}
          onChange={(event) =>
            setSettings({ ...settings, name: event.target.value })
          }
          data-testid="event-title-input"
        />
        <Input
          label={t('events.description')}
          value={description}
          maxLength={280}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t('events.startsAt')}
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="surface-input border-border h-10 rounded-md border-(length:--border-width) px-3 font-normal"
            data-testid="event-start-input"
          />
        </label>
        <RoomSettingsFields
          value={settings}
          onChange={setSettings}
          showName={false}
        />
      </div>
    </Dialog>
  );
};

const EventRow: FC<{ event: JamEvent; userId: string | undefined }> = ({
  event,
  userId,
}) => {
  const { t } = useTranslation('crossJam');
  const isHost = event.hostId === userId;
  const isGoing = userId ? event.rsvps.includes(userId) : false;
  const store = useCrossJamStore.getState;

  return (
    <li
      data-testid="event-row"
      className="surface-background border-border shadow-shadow flex flex-col gap-2 rounded-md border-(length:--border-width) p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h3 className="text-lg font-bold">{event.title}</h3>
          <span className="text-foreground/70 text-sm">
            {DateTime.fromMillis(event.startsAt).toLocaleString(
              DateTime.DATETIME_MED,
            )}{' '}
            · {t('events.hostedBy', { name: event.hostName })}
          </span>
        </div>
        {event.status === 'live' && (
          <Badge variant="pill" color="red" animated>
            {t('events.live')}
          </Badge>
        )}
      </div>
      {event.description && <p className="text-sm">{event.description}</p>}
      <div className="flex flex-wrap gap-1">
        {event.genres.map((genre) => (
          <Badge key={genre} variant="pill" color="secondary">
            {genre}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          {t('events.attendees', { count: event.rsvps.length })}
        </span>
        <div className="ml-auto flex gap-2">
          {event.status === 'live' && event.roomId && !isHost && (
            <Button
              size="sm"
              onClick={() =>
                store().joinRoom({ roomId: event.roomId as string })
              }
            >
              {t('events.joinLive')}
            </Button>
          )}
          {event.status === 'scheduled' && !isHost && (
            <Button
              size="sm"
              variant={isGoing ? 'default' : 'secondary'}
              onClick={() => store().rsvp(event.id, !isGoing)}
              data-testid="rsvp-button"
            >
              {isGoing ? t('events.going') : t('events.rsvp')}
            </Button>
          )}
          {event.status === 'scheduled' && isHost && (
            <>
              <Button
                size="sm"
                onClick={() => store().startEvent(event.id)}
                data-testid="start-event-button"
              >
                {t('events.start')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => store().cancelEvent(event.id)}
              >
                {t('events.cancel')}
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
};

export const EventsPanel: FC = () => {
  const { t } = useTranslation('crossJam');
  const events = useCrossJamStore((state) => state.events);
  const userId = useCrossJamStore((state) => state.profile?.userId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div
      data-testid="events-panel"
      className="flex flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <div>
        <Button
          onClick={() => setIsCreateOpen(true)}
          data-testid="create-event-button"
        >
          <CalendarPlusIcon size={16} />
          {t('events.create')}
        </Button>
      </div>
      {events.length === 0 ? (
        <EmptyState
          data-testid="events-empty"
          size="sm"
          title={t('events.empty')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => (
            <EventRow key={event.id} event={event} userId={userId} />
          ))}
        </ul>
      )}
      <CreateEventDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </div>
  );
};
