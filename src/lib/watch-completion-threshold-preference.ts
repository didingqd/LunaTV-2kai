import type { AdminConfig } from './admin.types';
import { getConfig } from './config';
import { sanitizeWatchCompletionThreshold } from './watching-update-calculation';

export interface WatchCompletionThresholdReader {
  getWatchCompletionThreshold(userId: string): Promise<number>;
}

export function getUserWatchCompletionThresholdFromConfig(
  config: AdminConfig,
  userId: string,
): number {
  const user = config.UserConfig.Users.find(
    (candidate) => candidate.username === userId,
  );
  return sanitizeWatchCompletionThreshold(user?.watchCompletionThreshold);
}

export const watchCompletionThresholdPreference: WatchCompletionThresholdReader =
  {
    async getWatchCompletionThreshold(userId: string) {
      const config = await getConfig();
      return getUserWatchCompletionThresholdFromConfig(config, userId);
    },
  };
