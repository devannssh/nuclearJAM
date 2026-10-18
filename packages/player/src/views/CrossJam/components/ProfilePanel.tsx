import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { JAM_LIMITS } from '@nuclearplayer/model';
import { Button, CopyButton, Input } from '@nuclearplayer/ui';

import { useCoreSetting } from '../../../hooks/useCoreSetting';
import { useCrossJamStore } from '../../../stores/crossJamStore';
import { GenrePicker } from './GenrePicker';
import { TasteImport } from './TasteImport';

export const ProfilePanel: FC = () => {
  const { t } = useTranslation('crossJam');
  const profile = useCrossJamStore((state) => state.profile);
  const friendCode = useCrossJamStore((state) => state.friendCode);
  const [savedUrl, setSavedUrl] = useCoreSetting<string>('crossJam.serverUrl');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [genres, setGenres] = useState(profile?.genres ?? []);
  const [serverUrl, setServerUrl] = useState(savedUrl ?? '');

  const handleSave = async () => {
    await setSavedUrl(serverUrl.trim());
    await useCrossJamStore
      .getState()
      .saveProfile({ displayName: displayName.trim(), genres });
  };

  return (
    <div
      data-testid="crossjam-profile"
      className="flex max-w-xl flex-col gap-6 overflow-y-auto p-4"
    >
      <Input
        label={t('profile.displayName')}
        value={displayName}
        maxLength={JAM_LIMITS.displayNameMax}
        onChange={(event) => setDisplayName(event.target.value)}
        data-testid="profile-display-name"
      />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{t('profile.genres')}</span>
        <span className="text-foreground/70 text-sm">
          {t('profile.genresDescription', { max: JAM_LIMITS.genresPerProfile })}
        </span>
        <GenrePicker
          value={genres}
          max={JAM_LIMITS.genresPerProfile}
          onChange={setGenres}
        />
        <TasteImport
          genres={genres}
          max={JAM_LIMITS.genresPerProfile}
          onChange={setGenres}
        />
      </div>
      <Input
        label={t('profile.serverUrl')}
        value={serverUrl}
        onChange={(event) => setServerUrl(event.target.value)}
      />
      {friendCode && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            {t('profile.friendCode')}
          </span>
          <code data-testid="own-friend-code">{friendCode}</code>
          <CopyButton text={friendCode} />
        </div>
      )}
      <Button
        disabled={!displayName.trim()}
        onClick={() => void handleSave()}
        data-testid="profile-save"
      >
        {t('profile.save')}
      </Button>
    </div>
  );
};
