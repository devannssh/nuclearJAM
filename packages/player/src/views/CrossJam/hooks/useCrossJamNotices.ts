import { useEffect } from 'react';
import { toast } from 'sonner';

import { useTranslation } from '@nuclearplayer/i18n';

import { useCrossJamStore } from '../../../stores/crossJamStore';

export const useCrossJamNotices = (): void => {
  const { t } = useTranslation('crossJam');
  const notice = useCrossJamStore((state) => state.notice);
  const startingEvent = useCrossJamStore((state) => state.startingEvent);

  useEffect(() => {
    if (notice) {
      toast.error(t(`errors.${notice.code}`));
    }
  }, [notice, t]);

  useEffect(() => {
    if (startingEvent) {
      toast(t('events.startingToast', { title: startingEvent.title }));
      useCrossJamStore.getState().dismissStartingEvent();
    }
  }, [startingEvent, t]);
};
