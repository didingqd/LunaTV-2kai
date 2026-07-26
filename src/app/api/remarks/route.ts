/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  getDbQueryCount,
  recordRequest,
  resetDbQueryCount,
} from '@/lib/performance-monitor';
import {
  BANGUMI_DATE_ORIGIN,
  MANUAL_ORIGIN,
  deleteRemarkEntries,
  normalizeOrigin,
  readRemarks,
  resolveRemarkEntry,
  resolveRemarkWriteKey,
  updateRemarks,
  writeRemarks,
} from '@/lib/video-remarks.server';

export const runtime = 'nodejs';

async function requireUser(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return { error: 'Unauthorized', status: 401 as const };
  }

  const config = await getConfig();
  if (authInfo.username !== process.env.USERNAME) {
    const user = config.UserConfig.Users.find(
      (item) => item.username === authInfo.username,
    );
    if (!user) return { error: '用户不存在', status: 401 as const };
    if (user.banned) return { error: '用户已被封禁', status: 401 as const };
  }

  return { username: authInfo.username };
}

function recordApiRequest(
  method: string,
  startTime: number,
  startMemory: number,
  statusCode: number,
  requestSize: number,
  payload: unknown,
) {
  recordRequest({
    timestamp: startTime,
    method,
    path: '/api/remarks',
    statusCode,
    duration: Date.now() - startTime,
    memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
    dbQueries: getDbQueryCount(),
    requestSize,
    responseSize: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
  });
}

function jsonResponse(
  method: string,
  startTime: number,
  startMemory: number,
  statusCode: number,
  requestSize: number,
  payload: unknown,
) {
  recordApiRequest(
    method,
    startTime,
    startMemory,
    statusCode,
    requestSize,
    payload,
  );
  return NextResponse.json(payload, { status: statusCode });
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  resetDbQueryCount();

  try {
    const user = await requireUser(request);
    if ('error' in user) {
      return jsonResponse('GET', startTime, startMemory, user.status, 0, {
        error: user.error,
      });
    }

    const source = request.nextUrl.searchParams.get('source')?.trim() || '';
    const id = request.nextUrl.searchParams.get('id')?.trim() || '';

    if (source && id) {
      const remarks = await readRemarks(user.username);
      const lookup = resolveRemarkEntry(remarks, source, id);
      const record = lookup?.migrated
        ? await updateRemarks(user.username, (latestRemarks) => {
            const latestLookup = resolveRemarkEntry(latestRemarks, source, id);
            return (
              latestLookup?.record || {
                remark: '',
                updatedAt: 0,
                origin: MANUAL_ORIGIN,
              }
            );
          })
        : lookup?.record || {
            remark: '',
            updatedAt: 0,
            origin: MANUAL_ORIGIN,
          };
      return jsonResponse('GET', startTime, startMemory, 200, 0, record);
    }

    const remarks = await readRemarks(user.username);
    return jsonResponse('GET', startTime, startMemory, 200, 0, remarks);
  } catch (err) {
    console.error('获取视频备注失败', err);
    return jsonResponse('GET', startTime, startMemory, 500, 0, {
      error: 'Internal Server Error',
    });
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  resetDbQueryCount();

  try {
    const user = await requireUser(request);
    if ('error' in user) {
      return jsonResponse('POST', startTime, startMemory, user.status, 0, {
        error: user.error,
      });
    }

    const body = await request.json();
    const requestSize = Buffer.byteLength(JSON.stringify(body), 'utf8');
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const remark = typeof body.remark === 'string' ? body.remark.trim() : '';
    const origin = normalizeOrigin(body.origin);
    const updatedAt =
      typeof body.updatedAt === 'number' && Number.isFinite(body.updatedAt)
        ? body.updatedAt
        : Date.now();

    if (!source || !id) {
      return jsonResponse('POST', startTime, startMemory, 400, requestSize, {
        error: 'Missing source or id',
      });
    }

    const result = await updateRemarks(user.username, (remarks) => {
      const lookup = resolveRemarkEntry(remarks, source, id);
      const key = resolveRemarkWriteKey(source, id);
      if (!lookup || !key) {
        return {
          status: 400,
          payload: { error: 'Invalid source or id' },
        };
      }
      const existing = lookup.record;

      if (origin === BANGUMI_DATE_ORIGIN) {
        if (!remark) {
          return {
            status: 200,
            payload: {
              success: true,
              record: existing || { remark: '', updatedAt, origin },
              ignored: true,
            },
          };
        }

        if (existing && existing.origin !== BANGUMI_DATE_ORIGIN) {
          return {
            status: 200,
            payload: {
              success: true,
              record: existing,
              ignored: true,
            },
          };
        }
      }

      if (existing && existing.updatedAt > updatedAt) {
        return {
          status: 200,
          payload: {
            success: true,
            record: existing,
            ignored: true,
          },
        };
      }

      if (remark || origin === MANUAL_ORIGIN) {
        remarks[key] = { remark, updatedAt, origin };
      } else {
        delete remarks[key];
      }

      return {
        status: 200,
        payload: {
          success: true,
          record: remarks[key] || { remark: '', updatedAt, origin },
        },
      };
    });

    return jsonResponse(
      'POST',
      startTime,
      startMemory,
      result.status,
      requestSize,
      result.payload,
    );
  } catch (err) {
    console.error('保存视频备注失败', err);
    return jsonResponse('POST', startTime, startMemory, 500, 0, {
      error: 'Internal Server Error',
    });
  }
}

export async function DELETE(request: NextRequest) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  resetDbQueryCount();

  try {
    const user = await requireUser(request);
    if ('error' in user) {
      return jsonResponse('DELETE', startTime, startMemory, user.status, 0, {
        error: user.error,
      });
    }

    const source = request.nextUrl.searchParams.get('source')?.trim() || '';
    const id = request.nextUrl.searchParams.get('id')?.trim() || '';
    const updatedAtParam = request.nextUrl.searchParams.get('updatedAt');
    const updatedAt = updatedAtParam ? Number(updatedAtParam) : Date.now();

    await updateRemarks(user.username, (remarks) => {
      if (source && id) {
        const lookup = resolveRemarkEntry(remarks, source, id);
        const existing = lookup?.record;

        if (!existing || existing.updatedAt <= updatedAt) {
          deleteRemarkEntries(remarks, source, id);
        }
        return;
      }

      Object.keys(remarks).forEach((key) => {
        delete remarks[key];
      });
    });

    return jsonResponse('DELETE', startTime, startMemory, 200, 0, {
      success: true,
    });
  } catch (err) {
    console.error('删除视频备注失败', err);
    return jsonResponse('DELETE', startTime, startMemory, 500, 0, {
      error: 'Internal Server Error',
    });
  }
}
