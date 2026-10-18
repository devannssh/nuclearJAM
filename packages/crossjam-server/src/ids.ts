import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const newId = (): string => randomUUID();

export const newCode = (length: number): string => {
  const bytes = randomBytes(length);
  return Array.from(
    bytes,
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
  ).join('');
};

export const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

export const secretsMatch = (secret: string, storedHash: string): boolean => {
  const candidate = Buffer.from(hashSecret(secret));
  const stored = Buffer.from(storedHash);
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
};
