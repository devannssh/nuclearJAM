import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import type { JamRoomState } from '@nuclearplayer/model';
import { Button, Dialog } from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';
import { RoomSettingsFields } from './RoomSettingsFields';

type RoomSettingsDialogProps = {
  room: JamRoomState;
  isOpen: boolean;
  onClose: () => void;
};

export const RoomSettingsDialog: FC<RoomSettingsDialogProps> = ({
  room,
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation('crossJam');
  const [settings, setSettings] = useState({
    name: room.name,
    genres: room.genres,
    privacy: room.privacy,
    capacity: room.capacity,
    skipMode: room.skipMode,
  });

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('room.settings')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('create.cancel')}
          </Button>
          <Button
            disabled={!settings.name.trim()}
            onClick={() => {
              useCrossJamStore.getState().updateRoomSettings({
                ...settings,
                name: settings.name.trim(),
              });
              onClose();
            }}
            data-testid="save-room-settings"
          >
            {t('room.saveSettings')}
          </Button>
        </>
      }
    >
      <RoomSettingsFields value={settings} onChange={setSettings} />
    </Dialog>
  );
};
