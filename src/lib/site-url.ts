import type { NextRequest } from 'next/server';

const LOCAL_DEV_SITE_URL = 'http://localhost:3000';
const INTERNAL_HOSTS = new Set(['0.0.0.0', '127.0.0.1']);

type SiteUrlRequest = Pick<NextRequest, 'url' | 'headers'>;

function isLocalhostAllowed() {
  return process.env.NODE_ENV !== 'production';
}

function normalizeOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(
      trimmed.includes('://') ? trimmed : `https://${trimmed}`,
    );
    if (INTERNAL_HOSTS.has(url.hostname)) return null;
    if (url.hostname === 'localhost' && !isLocalhostAllowed()) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null;
}

function originFromForwardedHeaders(request: SiteUrlRequest): string | null {
  const host = firstHeaderValue(request.headers.get('x-forwarded-host'));
  if (!host) return null;

  const proto =
    firstHeaderValue(request.headers.get('x-forwarded-proto')) ?? 'https';
  return normalizeOrigin(`${proto}://${host}`);
}

function originFromHostHeader(request: SiteUrlRequest): string | null {
  const host = firstHeaderValue(request.headers.get('host'));
  if (!host) return null;

  const protocol = request.url.startsWith('https://') ? 'https' : 'http';
  return normalizeOrigin(`${protocol}://${host}`);
}

export function getSiteUrl(request?: SiteUrlRequest): string | null {
  if (request) {
    const forwardedOrigin = originFromForwardedHeaders(request);
    if (forwardedOrigin) return forwardedOrigin;

    const hostOrigin = originFromHostHeader(request);
    if (hostOrigin) return hostOrigin;

    const requestOrigin = normalizeOrigin(request.url);
    if (requestOrigin) return requestOrigin;
  }

  const configuredOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (configuredOrigin) return configuredOrigin;

  return isLocalhostAllowed() ? LOCAL_DEV_SITE_URL : null;
}

export function buildUpdateCheckTriggerUrl(
  request: SiteUrlRequest,
  token: string | null,
): string | null {
  if (!token) return null;
  const siteUrl = getSiteUrl(request);
  if (!siteUrl) return null;

  const url = new URL('/api/update-check-trigger', siteUrl);
  url.searchParams.set('token', token);
  return url.toString();
}
