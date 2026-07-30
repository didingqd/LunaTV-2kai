/** @jest-environment node */

const start = jest.fn();

jest.mock('@/lib/scheduler/scheduler-manager', () => ({
  schedulerManager: { start },
}));

import { register } from './instrumentation';

const previousRuntime = process.env.NEXT_RUNTIME;
const previousVercel = process.env.VERCEL;

describe('instrumentation scheduler startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.VERCEL;
  });

  afterAll(() => {
    if (previousRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = previousRuntime;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  });

  it('starts the SchedulerManager in the Docker Node runtime', async () => {
    await register();

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not start the scheduler outside the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';

    await register();

    expect(start).not.toHaveBeenCalled();
  });

  it('does not start the Docker scheduler on Vercel', async () => {
    process.env.VERCEL = '1';

    await register();

    expect(start).not.toHaveBeenCalled();
  });
});
