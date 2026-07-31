jest.mock('./config', () => ({
  getConfig: jest.fn(),
}));
jest.mock('./scheduler/update-check-job-runner', () => ({
  updateCheckJobRunner: { run: jest.fn() },
}));

import type { AdminConfig } from './admin.types';
import {
  ManualTriggerUseCase,
  ManualTriggerUseCaseError,
} from './manual-trigger-use-case';
import type { UpdateCheckJobRunnerResult } from './scheduler/update-check-job-runner';

function jobResult(
  overrides: Partial<UpdateCheckJobRunnerResult> = {},
): UpdateCheckJobRunnerResult {
  return {
    trigger: 'manual',
    requestedBy: 'alice',
    startedAt: 1000,
    finishedAt: 1200,
    durationMs: 200,
    running: false,
    success: true,
    schedulerResult: {
      inspected: 1,
      succeeded: 1,
      failed: 0,
      oldestDueAt: 900,
    },
    ...overrides,
  };
}

describe('ManualTriggerUseCase', () => {
  it('runs the update check job through JobRunner', async () => {
    const run = jest.fn().mockResolvedValue(jobResult());
    const useCase = new ManualTriggerUseCase(async () => adminConfig(), { run });

    await expect(useCase.execute('alice')).resolves.toEqual({
      jobResult: jobResult(),
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      trigger: 'manual',
      requestedBy: 'alice',
    });
  });

  it('returns user not found before running the job', async () => {
    const run = jest.fn();
    const useCase = new ManualTriggerUseCase(async () => adminConfig([]), { run });

    await expect(useCase.execute('alice')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    } satisfies Partial<ManualTriggerUseCaseError>);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects when system backend updates are disabled', async () => {
    const run = jest.fn();
    const useCase = new ManualTriggerUseCase(
      async () => adminConfig(undefined, { updateCheckBackendEnabled: false }),
      { run },
    );

    await expect(useCase.execute('alice')).rejects.toMatchObject({
      code: 'WATCHING_UPDATE_NOT_ALLOWED',
    } satisfies Partial<ManualTriggerUseCaseError>);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects when scheduler is disabled', async () => {
    const run = jest.fn();
    const useCase = new ManualTriggerUseCase(
      async () => adminConfig(undefined, { updateCheckSchedulerEnabled: false }),
      { run },
    );

    await expect(useCase.execute('alice')).rejects.toMatchObject({
      code: 'SCHEDULER_DISABLED',
    } satisfies Partial<ManualTriggerUseCaseError>);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects when the user backend permission is disabled', async () => {
    const run = jest.fn();
    const useCase = new ManualTriggerUseCase(
      async () =>
        adminConfig([
          user({ username: 'alice', updateCheckBackendEnabled: false }),
        ]),
      { run },
    );

    await expect(useCase.execute('alice')).rejects.toMatchObject({
      code: 'WATCHING_UPDATE_NOT_ALLOWED',
    } satisfies Partial<ManualTriggerUseCaseError>);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects when trigger links are not allowed', async () => {
    const run = jest.fn();
    const useCase = new ManualTriggerUseCase(
      async () => adminConfig([user({ username: 'alice', allowTriggerLink: false })]),
      { run },
    );

    await expect(useCase.execute('alice')).rejects.toMatchObject({
      code: 'TRIGGER_LINK_NOT_ALLOWED',
    } satisfies Partial<ManualTriggerUseCaseError>);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects when trigger link metadata is disabled', async () => {
    const run = jest.fn();
    const useCase = new ManualTriggerUseCase(
      async () =>
        adminConfig([
          user({
            username: 'alice',
            watchingUpdateConfig: {
              triggerLink: { enabled: false, tokenId: 'token-1' },
            },
          }),
        ]),
      { run },
    );

    await expect(useCase.execute('alice')).rejects.toMatchObject({
      code: 'TRIGGER_LINK_DISABLED',
    } satisfies Partial<ManualTriggerUseCaseError>);
    expect(run).not.toHaveBeenCalled();
  });

  it('returns JobRunner single-flight result unchanged', async () => {
    const running = jobResult({
      running: true,
      success: false,
      error: 'UPDATE_CHECK_ALREADY_RUNNING',
      schedulerResult: null,
    });
    const run = jest.fn().mockResolvedValue(running);
    const useCase = new ManualTriggerUseCase(async () => adminConfig(), { run });

    await expect(useCase.execute('alice')).resolves.toEqual({
      jobResult: running,
    });
  });
});

function systemConfig(overrides: Partial<AdminConfig['SystemConfig']> = {}) {
  return {
    updateCheckBackendEnabled: true,
    updateCheckSchedulerEnabled: true,
    updateCheckCronInterval: 30 * 60 * 1000,
    updateCheckCronExpression: '*/30 * * * *',
    updateCheckTimezone: 'UTC',
    updateCheckLogRetentionCount: 200,
    updateCheckBatchSize: 100,
    updateCheckMaxUsers: 1000,
    updateCheckMaxFollowPerUser: 100,
    ...overrides,
  } as AdminConfig['SystemConfig'];
}

function user(
  overrides: Partial<AdminConfig['UserConfig']['Users'][number]> = {},
): AdminConfig['UserConfig']['Users'][number] {
  return {
    username: 'alice',
    role: 'user',
    updateCheckBackendEnabled: true,
    allowCustomSchedule: true,
    allowTriggerLink: true,
    watchingUpdateConfig: {
      triggerLink: { enabled: true, tokenId: 'token-1' },
    },
    ...overrides,
  };
}

function adminConfig(
  users: AdminConfig['UserConfig']['Users'] = [user()],
  systemOverrides: Partial<AdminConfig['SystemConfig']> = {},
): AdminConfig {
  return {
    SystemConfig: systemConfig(systemOverrides),
    UserConfig: { Users: users },
  } as AdminConfig;
}
