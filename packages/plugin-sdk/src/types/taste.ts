import type { ProviderDescriptor } from './providers';

export type TasteProvider = ProviderDescriptor<'taste'> & {
  fetchGenres: () => Promise<string[]>;
};
