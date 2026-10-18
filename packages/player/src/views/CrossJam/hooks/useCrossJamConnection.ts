import { useEffect } from 'react';

import { useCoreSetting } from '../../../hooks/useCoreSetting';
import { useCrossJamStore } from '../../../stores/crossJamStore';

export const useCrossJamConnection = (): void => {
  const displayName = useCrossJamStore((state) => state.profile?.displayName);
  const [serverUrl] = useCoreSetting<string>('crossJam.serverUrl');

  useEffect(() => {
    if (!displayName || !serverUrl) {
      return;
    }
    useCrossJamStore.getState().connect();

    return () => {
      if (!useCrossJamStore.getState().room) {
        useCrossJamStore.getState().disconnect();
      }
    };
  }, [displayName, serverUrl]);
};
