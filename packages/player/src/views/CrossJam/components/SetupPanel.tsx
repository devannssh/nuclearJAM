import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { JAM_LIMITS } from '@nuclearplayer/model';
import { Button, Input } from '@nuclearplayer/ui';

import { useCoreSetting } from '../../../hooks/useCoreSetting';
import { useCrossJamStore } from '../../../stores/crossJamStore';
import { GenrePicker } from './GenrePicker';
import { TasteImport } from './TasteImport';

export const SetupPanel: FC = () => {
  const { t } = useTranslation('crossJam');
  const profile = useCrossJamStore((state) => state.profile);
  const [savedUrl, setSavedUrl] = useCoreSetting<string>('crossJam.serverUrl');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [genres, setGenres] = useState(profile?.genres ?? []);
  const [serverUrl, setServerUrl] = useState(savedUrl ?? '');

  const canContinue =
    displayName.trim().length > 0 && serverUrl.trim().length > 0;

  const handleContinue = async () => {
    await setSavedUrl(serverUrl.trim());
    await useCrossJamStore
      .getState()
      .saveProfile({ displayName: displayName.trim(), genres });
  };

  return (
    <div
      data-testid="crossjam-setup"
      className="mx-auto flex w-full max-w-xl flex-col gap-6 overflow-y-auto p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold">{t('setup.title')}</h2>
        <p className="text-foreground/70">{t('setup.description')}</p>
      </div>
      <Input
        label={t('profile.displayName')}
        placeholder={t('profile.displayNamePlaceholder')}
        value={displayName}
        maxLength={JAM_LIMITS.displayNameMax}
        onChange={(event) => setDisplayName(event.target.value)}
        data-testid="setup-display-name"
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
        label={t('setup.serverUrl')}
        placeholder={t('setup.serverUrlPlaceholder')}
        value={serverUrl}
        onChange={(event) => setServerUrl(event.target.value)}
        data-testid="setup-server-url"
      />
      <Button
        disabled={!canContinue}
        onClick={() => void handleContinue()}
        data-testid="setup-continue"
      >
        {t('setup.continue')}
      </Button>
    </div>
  );
};
