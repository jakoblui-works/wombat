/** Waits for `promise`, but no longer than `ms`: it goes on in the background. */
export const settleWithin = async (promise: Promise<void>, ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
};

export const withTimeout = <T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
