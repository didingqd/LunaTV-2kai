import {
  cacheWatchCompletionThreshold,
  DEFAULT_WATCH_COMPLETION_THRESHOLD,
  loadWatchCompletionThreshold,
  sanitizeWatchCompletionThreshold,
  WATCH_COMPLETION_THRESHOLD_ENDPOINT,
} from '@/lib/watching-update-calculation';

type ThresholdFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface WatchCompletionThresholdClientOptions {
  username?: string | null;
  fetcher?: ThresholdFetch;
  storage?: Storage;
}

interface SaveWatchCompletionThresholdOptions extends WatchCompletionThresholdClientOptions {
  threshold: unknown;
}

function resolvePrincipal(username?: string | null): string | null {
  return username?.trim() || null;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' && payload.error.trim()
      ? payload.error
      : '观看完成判定保存失败';
  } catch {
    return '观看完成判定保存失败';
  }
}

/**
 * 设置入口专用的用户阈值读取封装。
 * 本次变更只在 Hook/Client Service 层读取账号级缓存：API 成功时以后端为准并写入当前账号缓存，
 * API 失败时只回退当前账号缓存或默认 80，避免重新启用旧的匿名 watch_completion_threshold。
 */
export async function getWatchCompletionThresholdPreference({
  username,
  fetcher,
  storage,
}: WatchCompletionThresholdClientOptions): Promise<number> {
  const principal = resolvePrincipal(username);
  if (!principal) return DEFAULT_WATCH_COMPLETION_THRESHOLD;

  const request = fetcher ?? fetch;
  try {
    const response = await request(WATCH_COMPLETION_THRESHOLD_ENDPOINT, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Failed to load watch threshold');

    const data = (await response.json()) as {
      watchCompletionThreshold?: unknown;
    };
    return cacheWatchCompletionThreshold(
      principal,
      data.watchCompletionThreshold,
      storage,
    );
  } catch {
    return loadWatchCompletionThreshold(principal, storage);
  }
}

/**
 * 设置入口专用的用户阈值保存封装。
 * 这里复用后端已有协议与现有 0-100 规范化规则；只有 PUT 成功后才更新账号级缓存，
 * 因而保存失败不会污染其他账号或影响当前 Watching Update 计算缓存。
 */
export async function saveWatchCompletionThresholdPreference({
  username,
  threshold,
  fetcher,
  storage,
}: SaveWatchCompletionThresholdOptions): Promise<number> {
  const principal = resolvePrincipal(username);
  if (!principal) throw new Error('请先登录后再修改观看完成判定');

  const normalizedThreshold = sanitizeWatchCompletionThreshold(threshold);
  const request = fetcher ?? fetch;
  const response = await request(WATCH_COMPLETION_THRESHOLD_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watchCompletionThreshold: normalizedThreshold }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const data = (await response.json()) as {
    watchCompletionThreshold?: unknown;
  };
  return cacheWatchCompletionThreshold(
    principal,
    data.watchCompletionThreshold,
    storage,
  );
}
