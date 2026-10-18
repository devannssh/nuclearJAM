import { DateTime } from 'luxon';
import { FC } from 'react';
import { toast } from 'sonner';

import { useTranslation } from '@nuclearplayer/i18n';
import type { JamRecapTrackCount } from '@nuclearplayer/model';
import { Button, Dialog } from '@nuclearplayer/ui';

import { fromJamTrack } from '../../../services/crossJam/trackMapping';
import { useCrossJamStore } from '../../../stores/crossJamStore';
import { usePlaylistStore } from '../../../stores/playlistStore';

const MS_PER_MINUTE = 60 * 1000;

const CountList: FC<{
  title: string;
  entries: JamRecapTrackCount[];
  testId: string;
}> = ({ title, entries, testId }) => {
  const { t } = useTranslation('crossJam');
  return (
    <section className="flex flex-col gap-1" data-testid={testId}>
      <h4 className="font-bold">{title}</h4>
      {entries.length === 0 ? (
        <span className="text-foreground/70 text-sm">
          {t('recapDialog.nothing')}
        </span>
      ) : (
        <ol className="flex flex-col gap-1 text-sm">
          {entries.map((entry) => (
            <li key={`${entry.track.source.provider}:${entry.track.source.id}`}>
              {entry.track.title} · {entry.track.artists.join(', ')}{' '}
              <span className="opacity-70">
                {t('recapDialog.times', { count: entry.count })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export const RecapDialog: FC = () => {
  const { t } = useTranslation('crossJam');
  const recap = useCrossJamStore((state) => state.recap);
  const dismiss = () => useCrossJamStore.getState().dismissRecap();

  const playableTracks =
    recap?.history
      .filter((entry) => !entry.skipped)
      .map((entry) => entry.track) ?? [];

  const saveAsPlaylist = async () => {
    if (!recap) {
      return;
    }
    const name = `${recap.roomName} · ${DateTime.now().toLocaleString(DateTime.DATE_MED)}`;
    const store = usePlaylistStore.getState();
    const playlistId = await store.createPlaylist(name);
    await store.addTracks(playlistId, playableTracks.map(fromJamTrack));
    toast.success(t('room.playlistSaved', { name }));
  };

  return (
    <Dialog
      isOpen={recap !== null}
      onClose={dismiss}
      title={t('recapDialog.title')}
      description={
        recap
          ? t('recapDialog.description', {
              room: recap.roomName,
              minutes: Math.max(
                1,
                Math.round(recap.durationMs / MS_PER_MINUTE),
              ),
            })
          : undefined
      }
      actions={
        <>
          <Button
            variant="secondary"
            disabled={playableTracks.length === 0}
            onClick={() => void saveAsPlaylist()}
            data-testid="save-playlist-button"
          >
            {t('room.saveAsPlaylist')}
          </Button>
          <Button onClick={dismiss} data-testid="recap-close">
            {t('recapDialog.close')}
          </Button>
        </>
      }
    >
      {recap && (
        <div data-testid="recap-content" className="flex flex-col gap-4">
          <div className="flex gap-8">
            <div className="flex flex-col">
              <span className="text-sm opacity-70">
                {t('recapDialog.tracksPlayed')}
              </span>
              <span
                className="text-2xl font-bold"
                data-testid="recap-tracks-played"
              >
                {recap.tracksPlayed}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm opacity-70">
                {t('recapDialog.topContributor')}
              </span>
              <span className="font-bold" data-testid="recap-top-contributor">
                {recap.topContributor
                  ? t('recapDialog.contributorValue', {
                      name: recap.topContributor.displayName,
                      count: recap.topContributor.added,
                    })
                  : t('recapDialog.nothing')}
              </span>
            </div>
          </div>
          <CountList
            title={t('recapDialog.mostAdded')}
            entries={recap.mostAdded}
            testId="recap-most-added"
          />
          <CountList
            title={t('recapDialog.mostSkipped')}
            entries={recap.mostSkipped}
            testId="recap-most-skipped"
          />
        </div>
      )}
    </Dialog>
  );
};
