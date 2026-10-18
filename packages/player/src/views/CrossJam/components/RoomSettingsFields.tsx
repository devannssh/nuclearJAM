import { FC } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import {
  JAM_LIMITS,
  type JamPrivacy,
  type JamRoomSettings,
  type JamSkipMode,
} from '@nuclearplayer/model';
import { Input, Select } from '@nuclearplayer/ui';

import { GenrePicker } from './GenrePicker';

type RoomSettingsFieldsProps = {
  value: JamRoomSettings;
  onChange: (settings: JamRoomSettings) => void;
  showName?: boolean;
};

export const RoomSettingsFields: FC<RoomSettingsFieldsProps> = ({
  value,
  onChange,
  showName = true,
}) => {
  const { t } = useTranslation('crossJam');
  const update = (changes: Partial<JamRoomSettings>) =>
    onChange({ ...value, ...changes });

  return (
    <div className="flex flex-col gap-4">
      {showName && (
        <Input
          label={t('create.name')}
          placeholder={t('create.namePlaceholder')}
          value={value.name}
          maxLength={JAM_LIMITS.roomNameMax}
          onChange={(event) => update({ name: event.target.value })}
          data-testid="room-name-input"
        />
      )}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{t('create.genres')}</span>
        <span className="text-foreground/70 text-sm">
          {t('create.genresDescription', { max: JAM_LIMITS.genresPerRoom })}
        </span>
        <GenrePicker
          data-testid="room-genre-picker"
          value={value.genres}
          max={JAM_LIMITS.genresPerRoom}
          onChange={(genres) => update({ genres })}
        />
      </div>
      <Select
        label={t('create.privacy')}
        value={value.privacy}
        options={[
          { id: 'public', label: t('create.public') },
          { id: 'invite', label: t('create.invite') },
        ]}
        onValueChange={(privacy) => update({ privacy: privacy as JamPrivacy })}
      />
      <Select
        label={t('create.skipMode')}
        value={value.skipMode}
        options={[
          { id: 'anyone', label: t('create.skipAnyone') },
          { id: 'vote', label: t('create.skipVote') },
          { id: 'host', label: t('create.skipHost') },
        ]}
        onValueChange={(skipMode) =>
          update({ skipMode: skipMode as JamSkipMode })
        }
      />
      <Input
        variant="number"
        label={t('create.capacity')}
        min={JAM_LIMITS.capacityMin}
        max={JAM_LIMITS.capacityMax}
        value={value.capacity}
        onChange={(event) =>
          update({
            capacity: Math.min(
              JAM_LIMITS.capacityMax,
              Math.max(JAM_LIMITS.capacityMin, Number(event.target.value) || 0),
            ),
          })
        }
        data-testid="room-capacity-input"
      />
    </div>
  );
};

export const defaultRoomSettings = (): JamRoomSettings => ({
  name: '',
  genres: [],
  privacy: 'public',
  capacity: 10,
  skipMode: 'anyone',
});
