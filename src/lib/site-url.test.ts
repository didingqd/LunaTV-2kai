/** @jest-environment node */

import { NextRequest } from 'next/server';

import { buildUpdateCheckTriggerUrl, getSiteUrl } from './site-url';

const originalNodeEnv = process.env.NODE_ENV;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

function request(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

function setNodeEnv(value: string) {
  (process.env as Record<string, string | undefined>)['NODE_ENV'] = value;
}

describe('site url helpers', () => {
  afterEach(() => {
    (process.env as Record<string, string | undefined>)['NODE_ENV'] =
      originalNodeEnv;
    if (originalSiteUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    }
  });

  it('uses the current request origin for normal deployments', () => {
    expect(
      buildUpdateCheckTriggerUrl(
        request('https://domain.com/admin'),
        'token.secret',
      ),
    ).toBe('https://domain.com/api/update-check-trigger?token=token.secret');
  });

  it('keeps localhost links for local development', () => {
    setNodeEnv('development');

    expect(
      buildUpdateCheckTriggerUrl(
        request('http://localhost:3000/admin'),
        'token.secret',
      ),
    ).toBe('http://localhost:3000/api/update-check-trigger?token=token.secret');
  });

  it('uses forwarded host and proto when the request URL is an internal bind address', () => {
    setNodeEnv('production');

    expect(
      buildUpdateCheckTriggerUrl(
        request('http://0.0.0.0:3000/admin', {
          'x-forwarded-host': 'example.com',
          'x-forwarded-proto': 'https',
        }),
        'token.secret',
      ),
    ).toBe('https://example.com/api/update-check-trigger?token=token.secret');
  });

  it('falls back to NEXT_PUBLIC_SITE_URL when request and forwarded origins are unusable', () => {
    setNodeEnv('production');
    process.env.NEXT_PUBLIC_SITE_URL = 'https://configured.example';

    expect(
      buildUpdateCheckTriggerUrl(
        request('http://0.0.0.0:3000/admin'),
        'token.secret',
      ),
    ).toBe(
      'https://configured.example/api/update-check-trigger?token=token.secret',
    );
  });

  it('does not return internal loopback origins as user-facing site URLs in production', () => {
    setNodeEnv('production');
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(getSiteUrl(request('http://0.0.0.0:3000/admin'))).toBeNull();
    expect(getSiteUrl(request('http://127.0.0.1:3000/admin'))).toBeNull();
    expect(getSiteUrl(request('http://localhost:3000/admin'))).toBeNull();
  });
});
