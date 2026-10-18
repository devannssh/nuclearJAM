let suppressNextAutoPlay = false;

export const suppressNextResolutionAutoPlay = (): void => {
  suppressNextAutoPlay = true;
};

export const consumeSuppressedAutoPlay = (): boolean => {
  const wasSuppressed = suppressNextAutoPlay;
  suppressNextAutoPlay = false;
  return wasSuppressed;
};
