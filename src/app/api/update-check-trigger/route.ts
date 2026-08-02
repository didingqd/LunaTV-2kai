import { NextRequest, NextResponse } from 'next/server';

import {
  updateCheckJobRunner,
  type UpdateCheckJobDisplayResult,
  type UpdateCheckJobStatusSnapshot,
  type UpdateCheckJobTriggerSource,
} from '@/lib/scheduler/update-check-job-runner';
import {
  triggerTokenService,
  type TriggerTokenVerifyResult,
} from '@/lib/trigger-token-service';
import { triggerLinkAccessControlService } from '@/lib/trigger-link-access-control-service';
import { getWatchingUpdateCheckLogRequestContext } from '@/lib/watching-update-check-log-request';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function noStoreHtml(html: string, status = 200) {
  return new NextResponse(html, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

function wantsHtml(request: NextRequest): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'json') return false;
  return request.headers.get('accept')?.includes('text/html') === true;
}

function isStatusOnly(request: NextRequest): boolean {
  const value = new URL(request.url).searchParams.get('status');
  return value === '1' || value === 'true';
}

function getTriggerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) return token;
  }

  const queryToken = new URL(request.url).searchParams.get('token')?.trim();
  return queryToken || null;
}

async function verifyTriggerToken(
  request: NextRequest,
): Promise<TriggerTokenVerifyResult | { error: string; status: number }> {
  const token = getTriggerToken(request);
  if (!token) return { error: 'invalid_token', status: 401 };
  try {
    return await triggerTokenService.verify(token);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'TRIGGER_TOKEN_DISABLED') {
        return { error: 'trigger_link_disabled', status: 403 };
      }
      if (error.message === 'TRIGGER_TOKEN_EXPIRED') {
        return { error: 'token_expired', status: 401 };
      }
    }
    return { error: 'invalid_token', status: 401 };
  }
}

function requestedTriggerSource(
  request: NextRequest,
): UpdateCheckJobTriggerSource {
  const value = request.headers.get('x-lunatv-trigger-source')?.trim();
  if (value === 'manual' || value === 'admin') return value;
  return 'external_http';
}

function responseFromStatus(
  snapshot: UpdateCheckJobStatusSnapshot,
  accepted: boolean,
) {
  const result = snapshot.result;
  return {
    success: true,
    accepted,
    status: snapshot.status,
    running: snapshot.running,
    taskId: snapshot.taskId,
    trigger: snapshot.trigger,
    triggerSource: snapshot.triggerSource,
    ...(snapshot.tokenId ? { tokenId: snapshot.tokenId } : {}),
    ...(snapshot.userId ? { userId: snapshot.userId } : {}),
    ...(snapshot.requestedBy ? { requestedBy: snapshot.requestedBy } : {}),
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    durationMs: snapshot.durationMs,
    ...(result
      ? {
          checkedCount: result.inspected,
          updateFoundCount: result.updateFoundCount,
          updates: result.updates,
        }
      : {}),
    result,
    displayResults: snapshot.displayResults ?? [],
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function episodeDelta(item: {
  fromEpisode: number;
  toEpisode: number;
}): number {
  return Math.max(0, item.toEpisode - item.fromEpisode);
}

function statusRefreshUrl(request: NextRequest): string {
  const url = new URL(request.url);
  url.searchParams.set('status', '1');
  return url.toString();
}

function resolveDisplayResult(
  snapshot: UpdateCheckJobStatusSnapshot,
  userId: string,
): UpdateCheckJobDisplayResult | null {
  const results = snapshot.displayResults ?? [];
  return (
    results.find((item) => item.userId === userId) ??
    results.find((item) => item.userId === snapshot.userId) ??
    null
  );
}

function renderUpdateItems(
  items: UpdateCheckJobDisplayResult['newUpdates'],
): string {
  return items
    .map(
      (item) => `
        <li class="update-item">
          <div class="title"><span class="bullet">•</span>${htmlEscape(item.title)}</div>
          <div class="episodes">
            ${htmlEscape(item.fromEpisode)} → ${htmlEscape(item.toEpisode)} 集
            <span class="delta">+${episodeDelta(item)}</span>
          </div>
        </li>`,
    )
    .join('');
}

function renderResultsPage(input: {
  request: NextRequest;
  snapshot: UpdateCheckJobStatusSnapshot;
  accepted: boolean;
  userId: string;
}) {
  const { request, snapshot, accepted, userId } = input;
  const refreshUrl = statusRefreshUrl(request);
  const running = snapshot.running || snapshot.status === 'running';
  const displayResult = resolveDisplayResult(snapshot, userId);
  const hasNewUpdates = (displayResult?.newUpdates.length ?? 0) > 0;
  const hasUpdated = (displayResult?.updated.length ?? 0) > 0;
  const hasAnyUpdates = hasNewUpdates || hasUpdated;
  const displayTime =
    displayResult?.displayTime ??
    (snapshot.finishedAt ? new Date(snapshot.finishedAt).toLocaleString() : '');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${running ? `<meta http-equiv="refresh" content="3;url=${htmlEscape(refreshUrl)}" />` : ''}
  <title>更新检测结果</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f8fafc;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { max-width: 760px; margin: 0 auto; padding: 32px 18px; }
    .panel {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fff;
      padding: 22px;
      box-shadow: 0 8px 26px rgba(15, 23, 42, 0.06);
    }
    h1 { margin: 0 0 16px; font-size: 22px; }
    .muted { color: #64748b; font-size: 14px; }
    .waiting {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #2563eb;
      font-weight: 600;
    }
    .spinner {
      width: 18px;
      height: 18px;
      border: 3px solid #bfdbfe;
      border-top-color: #2563eb;
      border-radius: 999px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    section { margin-top: 18px; }
    .section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      font-size: 17px;
      font-weight: 700;
    }
    .new .section-title { color: #dc2626; }
    .updated .section-title { color: #16a34a; }
    ul { list-style: none; margin: 0; padding: 0; }
    .update-item {
      border-top: 1px solid #e2e8f0;
      padding: 12px 0;
    }
    .update-item:first-child { border-top: 0; }
    .title { font-weight: 650; line-height: 1.5; }
    .bullet { margin-right: 8px; color: #64748b; }
    .episodes {
      margin-top: 4px;
      color: #475569;
      font-size: 15px;
    }
    .delta {
      display: inline-block;
      margin-left: 6px;
      border-radius: 999px;
      background: #fef3c7;
      color: #b45309;
      padding: 1px 8px;
      font-weight: 800;
    }
    .empty {
      margin-top: 18px;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 28px;
      text-align: center;
      color: #64748b;
      font-weight: 650;
    }
    .time {
      margin-top: 20px;
      border-top: 1px solid #e2e8f0;
      padding-top: 14px;
      color: #64748b;
      font-size: 14px;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #020617; color: #e2e8f0; }
      .panel { background: #0f172a; border-color: #1e293b; }
      .muted, .time, .empty { color: #94a3b8; }
      .update-item, .time { border-color: #1e293b; }
      .episodes { color: #cbd5e1; }
      .empty { border-color: #334155; }
    }
  </style>
</head>
<body>
  <main>
    <div class="panel">
      <h1>更新检测结果</h1>
      ${
        running
          ? `<div class="waiting"><span class="spinner"></span><span>${accepted ? '检测已启动，正在等待完成' : '检测中，请稍候'}</span></div>
             <p class="muted">页面会自动刷新。</p>`
          : `${
              hasAnyUpdates
                ? `${hasNewUpdates ? `<section class="new"><h2 class="section-title">🆕 新更新（${displayResult!.newUpdates.length}）</h2><ul>${renderUpdateItems(displayResult!.newUpdates)}</ul></section>` : ''}
                   ${hasUpdated ? `<section class="updated"><h2 class="section-title">✅ 已更新（${displayResult!.updated.length}）</h2><ul>${renderUpdateItems(displayResult!.updated)}</ul></section>` : ''}`
                : '<div class="empty">暂无更新</div>'
            }
            <div class="time">检测时间：${htmlEscape(displayTime || '-')}</div>`
      }
    </div>
  </main>
</body>
</html>`;
}

function renderErrorPage(message: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>更新检测结果</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f8fafc;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .panel {
      width: min(520px, calc(100vw - 36px));
      border: 1px solid #fecaca;
      border-radius: 8px;
      background: #fff;
      padding: 24px;
      color: #991b1b;
      box-shadow: 0 8px 26px rgba(15, 23, 42, 0.06);
    }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; }
    @media (prefers-color-scheme: dark) {
      body { background: #020617; color: #e2e8f0; }
      .panel {
        background: #0f172a;
        border-color: #7f1d1d;
        color: #fecaca;
      }
    }
  </style>
</head>
<body>
  <div class="panel">
    <h1>请求失败</h1>
    <p>${htmlEscape(message)}</p>
  </div>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  const renderHtml = wantsHtml(request);
  const verified = await verifyTriggerToken(request);
  if ('error' in verified) {
    if (renderHtml) {
      return noStoreHtml(
        renderErrorPage(
          verified.error === 'trigger_link_disabled'
            ? '触发链接已关闭'
            : verified.error === 'token_expired'
              ? 'Token 已过期'
              : 'Token 错误',
        ),
        verified.status,
      );
    }
    return noStoreJson(
      { success: false, error: verified.error },
      verified.status,
    );
  }

  const requestContext = getWatchingUpdateCheckLogRequestContext(
    request,
    verified.userId,
    undefined,
  );
  const accessDecision = await triggerLinkAccessControlService.authorize({
    tokenId: verified.tokenId,
    userId: verified.userId,
    ip: requestContext.request.client.ip,
    userAgent: requestContext.request.client.userAgent,
  });
  if (!accessDecision.allowed) {
    if (renderHtml) {
      return noStoreHtml(
        renderErrorPage(accessDecision.error ?? '访问受限'),
        accessDecision.status ?? 429,
      );
    }
    return noStoreJson(
      {
        success: false,
        error: accessDecision.error,
        ...(accessDecision.autoDisabled ? { triggerLinkDisabled: true } : {}),
      },
      accessDecision.status ?? 429,
    );
  }

  if (isStatusOnly(request)) {
    const snapshot = updateCheckJobRunner.getStatus();
    if (renderHtml) {
      return noStoreHtml(
        renderResultsPage({
          request,
          snapshot,
          accepted: false,
          userId: verified.userId,
        }),
      );
    }
    return noStoreJson(responseFromStatus(snapshot, false));
  }

  const current = updateCheckJobRunner.getStatus();
  if (current.running) {
    if (renderHtml) {
      return noStoreHtml(
        renderResultsPage({
          request,
          snapshot: current,
          accepted: false,
          userId: verified.userId,
        }),
      );
    }
    return noStoreJson(responseFromStatus(current, false));
  }

  const triggerSource = requestedTriggerSource(request);
  const logRequest = requestContext.request;
  const status = updateCheckJobRunner.runInBackground({
    mode: 'user',
    trigger: 'trigger-link',
    triggerSource,
    userId: verified.userId,
    tokenId: verified.tokenId,
    requestedBy: verified.userId,
    preserveNextCheckAt: true,
    audit: {
      source: 'trigger',
      operation: 'manual-trigger',
      request: {
        ...logRequest,
        tokenId: verified.tokenId,
        requestedBy: verified.userId,
        trigger: triggerSource,
      },
      userIds: [verified.userId],
    },
  });

  if (renderHtml) {
    return noStoreHtml(
      renderResultsPage({
        request,
        snapshot: status,
        accepted: status.running,
        userId: verified.userId,
      }),
    );
  }
  return noStoreJson(responseFromStatus(status, status.running));
}
