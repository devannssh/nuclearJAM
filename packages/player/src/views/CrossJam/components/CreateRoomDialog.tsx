import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { Button, Dialog } from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';
import { defaultRoomSettings, RoomSettingsFields } from './RoomSettingsFields';

type CreateRoomDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const CreateRoomDialog: FC<CreateRoomDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation('crossJam');
  const [settings, setSettings] = useState(defaultRoomSettings);

  const handleSubmit = () => {
    useCrossJamStore.getState().createRoom({
      ...settings,
      name: settings.name.trim(),
    });
    setSettings(defaultRoomSettings());
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('create.title')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('create.cancel')}
          </Button>
          <Button
            disabled={!settings.name.trim()}
            onClick={handleSubmit}
            data-testid="create-room-submit"
          >
            {t('create.submit')}
          </Button>
        </>
      }
    >
      <RoomSettingsFields value={settings} onChange={setSettings} />
    </Dialog>
  );
};
