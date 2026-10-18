import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { Button } from '@nuclearplayer/ui';

import { useProviders } from '../../../hooks/useProviders';
import { importGenresFromProvider } from '../../../services/crossJam/tasteImport';
import { reportError } from '../../../utils/logging';

type TasteImportProps = {
  genres: string[];
  max: number;
  onChange: (genres: string[]) => void;
};

export const TasteImport: FC<TasteImportProps> = ({
  genres,
  max,
  onChange,
}) => {
  const { t } = useTranslation('crossJam');
  const providers = useProviders('taste');
  const [busyId, setBusyId] = useState<string | null>(null);

  if (providers.length === 0) {
    return null;
  }

  const handleImport = async (providerId: string) => {
    setBusyId(providerId);
    try {
      onChange(await importGenresFromProvider(providerId, genres, max));
    } catch (error) {
      await reportError('crossjam', {
        userMessage: t('taste.importFailed'),
        error,
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-testid="taste-import" className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{t('taste.title')}</span>
      <div className="flex flex-wrap gap-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            size="sm"
            variant="secondary"
            disabled={busyId !== null}
            onClick={() => void handleImport(provider.id)}
            data-testid={`taste-import-${provider.id}`}
          >
            {t('taste.import', { name: provider.name })}
          </Button>
        ))}
      </div>
    </div>
  );
};
