import type { NextRequest } from 'next/server';

import type {
  WatchingUpdateCheckLogClient,
  WatchingUpdateCheckLogRequest,
  WatchingUpdateCheckLogSource,
} from './watching-update-check-log-types';

const SENSITIVE_KEY_PATTERN = /authorization|cookie|token|password|secret/i;
const MAX_BODY_DEPTH = 6;
const MAX_BODY_ITEMS = 200;
const MAX_STRING_LENGTH = 2048;

function optionalHeader(
  request: NextRequest,
  name: string,
): string | undefined {
  const value = request.headers.get(name)?.trim();
  return value ? value.slice(0, MAX_STRING_LENGTH) : undefined;
}

function inferDevice(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  if (/mobile|android|iphone|ipod/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

function inferPlatform(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  if (/mac os|macintosh/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return undefined;
}

function resolveClientSource(
  value: string | undefined,
): WatchingUpdateCheckLogSource {
  return value === 'app' || value === 'admin' || value === 'web'
    ? value
    : 'web';
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_BODY_DEPTH) return '[truncated]';
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_BODY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return String(value);

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_BODY_ITEMS)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[redacted]'
      : sanitizeValue(item, depth + 1);
  }
  return result;
}

export function sanitizeWatchingUpdateCheckLogBody(value: unknown): unknown {
  return sanitizeValue(value);
}

export function getWatchingUpdateCheckLogRequestContext(
  request: NextRequest,
  userId: string | undefined,
  body: unknown,
): {
  source: WatchingUpdateCheckLogSource;
  request: WatchingUpdateCheckLogRequest;
} {
  const userAgent = optionalHeader(request, 'user-agent');
  const client: WatchingUpdateCheckLogClient = {
    platform:
      optionalHeader(request, 'x-lunatv-platform') ??
      optionalHeader(request, 'sec-ch-ua-platform') ??
      inferPlatform(userAgent),
    version: optionalHeader(request, 'x-lunatv-version'),
    device:
      optionalHeader(request, 'x-lunatv-device') ?? inferDevice(userAgent),
    userAgent,
    ip:
      optionalHeader(request, 'cf-connecting-ip') ??
      optionalHeader(request, 'x-forwarded-for')?.split(',')[0]?.trim() ??
      optionalHeader(request, 'x-real-ip'),
  };

  return {
    source: resolveClientSource(
      optionalHeader(request, 'x-lunatv-client-source'),
    ),
    request: {
      method: request.method,
      path: new URL(request.url).pathname,
      ...(userId ? { userId } : {}),
      ...(body === undefined
        ? {}
        : { body: sanitizeWatchingUpdateCheckLogBody(body) }),
      client,
    },
  };
}
