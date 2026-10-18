import type { JamMember } from '@nuclearplayer/model';

import { useCrossJamStore } from '../../../stores/crossJamStore';

type JamMembership = {
  userId: string | undefined;
  member: JamMember | undefined;
  isHost: boolean;
  isController: boolean;
};

export const useJamMembership = (): JamMembership => {
  const userId = useCrossJamStore((state) => state.profile?.userId);
  const member = useCrossJamStore((state) =>
    state.room?.members.find(
      (candidate) => candidate.userId === state.profile?.userId,
    ),
  );
  return {
    userId,
    member,
    isHost: member?.role === 'host',
    isController: member?.role === 'host' || member?.role === 'cohost',
  };
};
