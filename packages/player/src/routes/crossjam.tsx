import { createFileRoute } from '@tanstack/react-router';

import { CrossJam } from '../views/CrossJam';

export const Route = createFileRoute('/crossjam')({
  component: CrossJam,
});
