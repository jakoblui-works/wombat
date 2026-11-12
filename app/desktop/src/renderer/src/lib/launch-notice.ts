/**
 * Whether the launch notice shows on this connection: the first time in a launch (`shown` is false), for a service that
 * started before the app did. A service without a start time can't be told, so it gets no notice.
 */
export const showsLaunchNotice = ({ startedAt, launchedAt, shown }: { startedAt: string | undefined; launchedAt: number; shown: boolean }): boolean => {
  if (shown || startedAt === undefined) return false;
  return Date.parse(startedAt) < launchedAt;
};
