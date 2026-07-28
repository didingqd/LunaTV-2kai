import {
  getWatchCompletionThresholdPreference,
  saveWatchCompletionThresholdPreference,
} from './watch-completion-threshold';
import {
  WATCH_COMPLETION_THRESHOLD_ENDPOINT,
  watchCompletionThresholdStorageKey,
} from '@/lib/watching-update-calculation';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('watch completion threshold client service', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads and caches each user threshold independently', async () => {
    const fetcher = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === WATCH_COMPLETION_THRESHOLD_ENDPOINT) {
        return jsonResponse({
          watchCompletionThreshold: fetcher.mock.calls.length === 1 ? 50 : 90,
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    await expect(
      getWatchCompletionThresholdPreference({
        username: 'alice',
        fetcher,
        storage: window.localStorage,
      }),
    ).resolves.toBe(50);
    await expect(
      getWatchCompletionThresholdPreference({
        username: 'bob',
        fetcher,
        storage: window.localStorage,
      }),
    ).resolves.toBe(90);

    expect(
      window.localStorage.getItem(watchCompletionThresholdStorageKey('alice')),
    ).toBe('50');
    expect(
      window.localStorage.getItem(watchCompletionThresholdStorageKey('bob')),
    ).toBe('90');
    expect(
      window.localStorage.getItem('watch_completion_threshold'),
    ).toBeNull();
  });

  it('falls back to current user cache on GET failure without reading anonymous storage', async () => {
    window.localStorage.setItem('watch_completion_threshold', '30');
    window.localStorage.setItem(
      watchCompletionThresholdStorageKey('alice'),
      '50',
    );
    const fetcher = jest.fn(async () => jsonResponse({ error: 'fail' }, 500));

    await expect(
      getWatchCompletionThresholdPreference({
        username: 'alice',
        fetcher,
        storage: window.localStorage,
      }),
    ).resolves.toBe(50);
    await expect(
      getWatchCompletionThresholdPreference({
        username: 'bob',
        fetcher,
        storage: window.localStorage,
      }),
    ).resolves.toBe(80);
  });

  it('saves 0 and 100 through the existing PUT API protocol', async () => {
    const seenBodies: unknown[] = [];
    const fetcher = jest.fn(async (_input: RequestInfo | URL, init) => {
      seenBodies.push(JSON.parse(String(init?.body)));
      return jsonResponse(JSON.parse(String(init?.body)));
    });

    await expect(
      saveWatchCompletionThresholdPreference({
        username: 'alice',
        threshold: 0,
        fetcher,
        storage: window.localStorage,
      }),
    ).resolves.toBe(0);
    await expect(
      saveWatchCompletionThresholdPreference({
        username: 'alice',
        threshold: 100,
        fetcher,
        storage: window.localStorage,
      }),
    ).resolves.toBe(100);

    expect(fetcher).toHaveBeenCalledWith(WATCH_COMPLETION_THRESHOLD_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchCompletionThreshold: 0 }),
    });
    expect(seenBodies).toEqual([
      { watchCompletionThreshold: 0 },
      { watchCompletionThreshold: 100 },
    ]);
    expect(
      window.localStorage.getItem(watchCompletionThresholdStorageKey('alice')),
    ).toBe('100');
  });

  it('does not overwrite the account cache when PUT fails', async () => {
    window.localStorage.setItem(
      watchCompletionThresholdStorageKey('alice'),
      '80',
    );
    const fetcher = jest.fn(async () =>
      jsonResponse({ error: 'server denied' }, 500),
    );

    await expect(
      saveWatchCompletionThresholdPreference({
        username: 'alice',
        threshold: 50,
        fetcher,
        storage: window.localStorage,
      }),
    ).rejects.toThrow('server denied');
    expect(
      window.localStorage.getItem(watchCompletionThresholdStorageKey('alice')),
    ).toBe('80');
  });

  it('keeps unauthenticated users on the default threshold', async () => {
    const fetcher = jest.fn();

    await expect(
      getWatchCompletionThresholdPreference({
        username: null,
        fetcher,
        storage: window.localStorage,
      }),
    ).resolves.toBe(80);
    await expect(
      saveWatchCompletionThresholdPreference({
        username: null,
        threshold: 50,
        fetcher,
        storage: window.localStorage,
      }),
    ).rejects.toThrow('请先登录后再修改观看完成判定');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
