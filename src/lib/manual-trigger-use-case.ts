import type { AdminConfig } from './admin.types';
import { getConfig } from './config';
import {
  updateCheckJobRunner,
  type UpdateCheckJobRunner,
  type UpdateCheckJobRunnerResult,
} from './scheduler/update-check-job-runner';
import { resolveUserWatchingUpdateConfig } from './user-watching-update-config-resolver';
import type { WatchingUpdateCheckLogRequest } from './watching-update-check-log-types';

export type ManualTriggerUseCaseErrorCode =
  | 'USER_NOT_FOUND'
  | 'WATCHING_UPDATE_NOT_ALLOWED'
  | 'TRIGGER_LINK_DISABLED'
  | 'SCHEDULER_DISABLED';

export class ManualTriggerUseCaseError extends Error {
  constructor(readonly code: ManualTriggerUseCaseErrorCode) {
    super(code);
    this.name = 'ManualTriggerUseCaseError';
  }
}

export interface ManualTriggerUseCaseResult {
  jobResult: UpdateCheckJobRunnerResult;
}

export interface ManualTriggerUseCaseOptions {
  /**
   * Stage 4H-H: the API route can pass sanitized request metadata into the
   * JobRunner audit log without exposing trigger-token secrets to persistence.
   */
  auditRequest?: WatchingUpdateCheckLogRequest;
}

type JobRunner = Pick<UpdateCheckJobRunner, 'run'>;

export class ManualTriggerUseCase {
  constructor(
    private readonly loadConfig: () => Promise<AdminConfig> = getConfig,
    private readonly jobRunner: JobRunner = updateCheckJobRunner,
  ) {}

  async execute(
    userId: string,
    options: ManualTriggerUseCaseOptions = {},
  ): Promise<ManualTriggerUseCaseResult> {
    const config = await this.loadConfig();
    const user = config.UserConfig.Users.find(
      (candidate) => candidate.username === userId,
    );
    if (!user) throw new ManualTriggerUseCaseError('USER_NOT_FOUND');
    if (config.SystemConfig?.updateCheckSchedulerEnabled === false) {
      throw new ManualTriggerUseCaseError('SCHEDULER_DISABLED');
    }

    const effective = resolveUserWatchingUpdateConfig({
      username: user.username,
      userUpdateCheckBackendEnabled: user.updateCheckBackendEnabled === true,
      allowCustomSchedule: user.allowCustomSchedule,
      systemConfig: config.SystemConfig,
      userConfig: user.watchingUpdateConfig,
    });

    if (!effective.enabled) {
      throw new ManualTriggerUseCaseError('WATCHING_UPDATE_NOT_ALLOWED');
    }
    if (user.watchingUpdateConfig?.triggerLink?.enabled !== true) {
      throw new ManualTriggerUseCaseError('TRIGGER_LINK_DISABLED');
    }

    return {
      jobResult: await this.jobRunner.run({
        mode: 'user',
        trigger: 'manual',
        triggerSource: 'manual',
        userId: user.username,
        requestedBy: user.username,
        preserveNextCheckAt: true,
        audit: {
          source: 'trigger',
          operation: 'manual-trigger',
          ...(options.auditRequest ? { request: options.auditRequest } : {}),
          userIds: [user.username],
        },
      }),
    };
  }
}

export const manualTriggerUseCase = new ManualTriggerUseCase();
