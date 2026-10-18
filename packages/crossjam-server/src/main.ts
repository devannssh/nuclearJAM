import { createFilePersistence } from './persistence';
import { startTransport } from './transport';

const port = Number(process.env.PORT ?? 4180);
const host = process.env.HOST ?? '0.0.0.0';
const dataFile = process.env.CROSSJAM_DATA_FILE ?? './data/crossjam.json';

const running = await startTransport({
  port,
  host,
  persistence: createFilePersistence(dataFile),
});

console.log(`Cross Jam server listening on ws://${host}:${running.port}/jam`);

const shutdown = (): void => {
  void running.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
