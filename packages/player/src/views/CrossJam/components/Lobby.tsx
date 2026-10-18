import { FC, useState } from 'react';

import { useTranslation } from '@nuclearplayer/i18n';
import { Badge, Button, Tabs } from '@nuclearplayer/ui';

import { useCrossJamStore } from '../../../stores/crossJamStore';
import { EventsPanel } from './EventsPanel';
import { FriendsPanel } from './FriendsPanel';
import { ProfilePanel } from './ProfilePanel';
import { RoomBrowser } from './RoomBrowser';

export const Lobby: FC = () => {
  const { t } = useTranslation('crossJam');
  const status = useCrossJamStore((state) => state.status);
  const incomingCount = useCrossJamStore(
    (state) => state.incomingRequests.length,
  );
  const [selectedTab, setSelectedTab] = useState(0);

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-hidden">
      <div
        data-testid="connection-status"
        className="flex items-center gap-2 px-4 text-sm"
      >
        <Badge
          variant="dot"
          color={status === 'connected' ? 'green' : 'orange'}
          animated={status === 'connecting'}
        />
        <span>{t(`status.${status}`)}</span>
        {status === 'disconnected' && (
          <Button
            size="xs"
            variant="secondary"
            onClick={() => useCrossJamStore.getState().connect()}
          >
            {t('status.retry')}
          </Button>
        )}
      </div>
      <Tabs
        selectedIndex={selectedTab}
        onChange={setSelectedTab}
        className="flex flex-1 flex-col overflow-hidden"
        panelsClassName="flex-1 overflow-hidden"
        panelClassName="flex flex-1 overflow-hidden"
        items={[
          { id: 'rooms', label: t('tabs.rooms'), content: <RoomBrowser /> },
          {
            id: 'friends',
            label:
              incomingCount > 0
                ? `${t('tabs.friends')} (${incomingCount})`
                : t('tabs.friends'),
            content: <FriendsPanel />,
          },
          { id: 'events', label: t('tabs.events'), content: <EventsPanel /> },
          {
            id: 'profile',
            label: t('tabs.profile'),
            content: <ProfilePanel />,
          },
        ]}
      />
    </div>
  );
};
