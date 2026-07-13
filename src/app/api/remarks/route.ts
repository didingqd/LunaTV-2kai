/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  getDbQueryCount,
  recordRequest,
  resetDbQueryCount,
} from '@/lib/performance-monitor';

export const runtime = 'nodejs';

type RemarkRecord = {
  remark: string;
  updatedAt: number;
};

type RemarksMap = Record<string, RemarkRecord>;

function remarksCacheKey(username: string) {
  return `user:${username}:video_remarks`;
}

function buildRemarkKey(source: string, id: string) {
  return `${source.trim()}__${id.trim()}`;
}

function normalizeRecord(value: unknown): RemarkRecord | null {
  if (typeof value === 'string') {
    const remark = value.trim();
    return remark ? { remark, updatedAt: 0 } : null;
  }

  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const remark = typeof raw.remark === 'string' ? raw.remark.trim() : '';
  if (!remark) return null;

  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : 0;

  return { remark, updatedAt };
}

function normalizeRemarks(value: unknown): RemarksMap {
  if (!value || typeof value !== 'object') return {};

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, record]) => [key, normalizeRecord(record)] as const)
    .filter((entry): entry is readonly [string, RemarkRecord] => !!entry[1]);

  return Object.fromEntries(entries);
}

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

async function readRemarks(username: string): Promise<RemarksMap> {
  return normalizeRemarks(await db.getCache(remarksCacheKey(username)));
}

async function writeRemarks(username: string, remarks: RemarksMap) {
  await db.setCache(remarksCacheKey(username), remarks);
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

    const remarks = await readRemarks(user.username);
    const source = request.nextUrl.searchParams.get('source')?.trim() || '';
    const id = request.nextUrl.searchParams.get('id')?.trim() || '';

    if (source && id) {
      const record = remarks[buildRemarkKey(source, id)] || {
        remark: '',
        updatedAt: 0,
      };
      return jsonResponse('GET', startTime, startMemory, 200, 0, record);
    }

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
    const updatedAt =
      typeof body.updatedAt === 'number' && Number.isFinite(body.updatedAt)
        ? body.updatedAt
        : Date.now();

    if (!source || !id) {
      return jsonResponse('POST', startTime, startMemory, 400, requestSize, {
        error: 'Missing source or id',
      });
    }

    const remarks = await readRemarks(user.username);
    const key = buildRemarkKey(source, id);
    const existing = remarks[key];

    if (existing && existing.updatedAt > updatedAt) {
      return jsonResponse('POST', startTime, startMemory, 200, requestSize, {
        success: true,
        record: existing,
        ignored: true,
      });
    }

    if (remark) {
      remarks[key] = { remark, updatedAt };
    } else {
      delete remarks[key];
    }

    await writeRemarks(user.username, remarks);

    return jsonResponse('POST', startTime, startMemory, 200, requestSize, {
      success: true,
      record: remarks[key] || { remark: '', updatedAt },
    });
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

    if (source && id) {
      const remarks = await readRemarks(user.username);
      const key = buildRemarkKey(source, id);
      const existing = remarks[key];

      if (!existing || existing.updatedAt <= updatedAt) {
        delete remarks[key];
        await writeRemarks(user.username, remarks);
      }
    } else {
      await writeRemarks(user.username, {});
    }

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
