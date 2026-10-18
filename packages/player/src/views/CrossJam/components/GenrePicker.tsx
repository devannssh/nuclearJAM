import { PlusIcon } from 'lucide-react';
import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import {
  JAM_LIMITS,
  JAM_SUGGESTED_GENRES,
  normalizeGenre,
} from '@nuclearplayer/model';
import { Button, FilterChips, Input } from '@nuclearplayer/ui';

type GenrePickerProps = {
  value: string[];
  onChange: (genres: string[]) => void;
  max: number;
  'data-testid'?: string;
};

export const GenrePicker: FC<GenrePickerProps> = ({
  value,
  onChange,
  max,
  'data-testid': testId = 'genre-picker',
}) => {
  const { t } = useTranslation('crossJam');
  const [draft, setDraft] = useState('');
  const options = [...new Set([...JAM_SUGGESTED_GENRES, ...value])];

  const addCustomGenre = () => {
    const genre = normalizeGenre(draft).slice(0, JAM_LIMITS.genreMax);
    setDraft('');
    if (genre && !value.includes(genre) && value.length < max) {
      onChange([...value, genre]);
    }
  };

  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <FilterChips
        multiple
        items={options.map((genre) => ({ id: genre, label: genre }))}
        selected={value}
        onChange={(genres) => onChange(genres.slice(0, max))}
        className="flex-wrap"
      />
      <div className="flex items-end gap-2">
        <Input
          label={t('profile.customGenre')}
          value={draft}
          maxLength={JAM_LIMITS.genreMax}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              addCustomGenre();
            }
          }}
          data-testid={`${testId}-custom-input`}
        />
        <Button
          variant="secondary"
          onClick={addCustomGenre}
          disabled={!draft.trim() || value.length >= max}
          data-testid={`${testId}-add`}
        >
          <PlusIcon size={16} />
          {t('profile.addGenre')}
        </Button>
      </div>
    </div>
  );
};
