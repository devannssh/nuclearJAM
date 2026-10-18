import { FC } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { ViewShell } from '@nuclearplayer/ui';

import { useCoreSetting } from '../../hooks/useCoreSetting';
import { useCrossJamStore } from '../../stores/crossJamStore';
import { JamRoom } from './components/JamRoom';
import { Lobby } from './components/Lobby';
import { RecapDialog } from './components/RecapDialog';
import { SetupPanel } from './components/SetupPanel';
import { useCrossJamConnection } from './hooks/useCrossJamConnection';
import { useCrossJamNotices } from './hooks/useCrossJamNotices';

export const CrossJam: FC = () => {
  const { t } = useTranslation('crossJam');
  const profile = useCrossJamStore((state) => state.profile);
  const room = useCrossJamStore((state) => state.room);
  const [serverUrl] = useCoreSetting<string>('crossJam.serverUrl');
  useCrossJamConnection();
  useCrossJamNotices();

  const needsSetup = !profile?.displayName || !serverUrl;

  return (
    <ViewShell data-testid="crossjam-view" title={t('title')}>
      {needsSetup ? <SetupPanel /> : room ? <JamRoom /> : <Lobby />}
      <RecapDialog />
    </ViewShell>
  );
};
