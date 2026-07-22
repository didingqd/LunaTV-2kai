/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { updateCheckService } from '@/lib/update-check-service';
import {
  recordRequest,
  getDbQueryCount,
  resetDbQueryCount,
} from '@/lib/performance-monitor';
import { PlayRecord } from '@/lib/types';
import {
  parsePlayRecordStorageKey,
  playbackFactsOnly,
} from '@/lib/play-record';
import {
  parseLegacyPlayRecordKey,
  resolvePlayRecordIdentity,
} from '@/lib/play-record-identity';

export const runtime = 'nodejs';

function playRecordIdentityError(key: string): string {
  const legacy = parseLegacyPlayRecordKey(key);
  return 'reason' in legacy && legacy.reason === 'ambiguous'
    ? 'ambiguous legacy identity'
    : 'Invalid key format';
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  resetDbQueryCount();

  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      const errorResponse = { error: 'Unauthorized' };
      const errorSize = Buffer.byteLength(
        JSON.stringify(errorResponse),
        'utf8',
      );

      recordRequest({
        timestamp: startTime,
        method: 'GET',
        path: '/api/playrecords',
        statusCode: 401,
        duration: Date.now() - startTime,
        memoryUsed:
          (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize: 0,
        responseSize: errorSize,
      });

      return NextResponse.json(errorResponse, { status: 401 });
    }

    const config = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username,
      );
      if (!user) {
        const errorResponse = { error: '用户不存在' };
        const errorSize = Buffer.byteLength(
          JSON.stringify(errorResponse),
          'utf8',
        );

        recordRequest({
          timestamp: startTime,
          method: 'GET',
          path: '/api/playrecords',
          statusCode: 401,
          duration: Date.now() - startTime,
          memoryUsed:
            (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
          dbQueries: getDbQueryCount(),
          requestSize: 0,
          responseSize: errorSize,
        });

        return NextResponse.json(errorResponse, { status: 401 });
      }
      if (user.banned) {
        const errorResponse = { error: '用户已被封禁' };
        const errorSize = Buffer.byteLength(
          JSON.stringify(errorResponse),
          'utf8',
        );

        recordRequest({
          timestamp: startTime,
          method: 'GET',
          path: '/api/playrecords',
          statusCode: 401,
          duration: Date.now() - startTime,
          memoryUsed:
            (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
          dbQueries: getDbQueryCount(),
          requestSize: 0,
          responseSize: errorSize,
        });

        return NextResponse.json(errorResponse, { status: 401 });
      }
    }

    const records = await db.getAllPlayRecords(authInfo.username);

    // 数据升级：确保旧播放记录包含新字段，防止前端崩溃
    const upgradedRecords: Record<string, PlayRecord> = {};
    for (const [key, record] of Object.entries(records)) {
      upgradedRecords[key] = {
        ...(record as PlayRecord),
        // 确保 type 字段存在
        type: (record as any).type || undefined,
        // 确保 douban_id 字段存在
        douban_id: (record as any).douban_id || undefined,
        // 确保 remarks 字段存在
        remarks: (record as any).remarks || undefined,
        // 确保 original_episodes 字段存在
        original_episodes: (record as any).original_episodes || undefined,
      };
    }

    const responseSize = Buffer.byteLength(
      JSON.stringify(upgradedRecords),
      'utf8',
    );

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/playrecords',
      statusCode: 200,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize,
    });

    return NextResponse.json(upgradedRecords, { status: 200 });
  } catch (err) {
    console.error('获取播放记录失败', err);
    const errorResponse = { error: 'Internal Server Error' };
    const errorSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'GET',
      path: '/api/playrecords',
      statusCode: 500,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize: errorSize,
    });

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  resetDbQueryCount();

  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      const errorResponse = { error: 'Unauthorized' };
      const errorSize = Buffer.byteLength(
        JSON.stringify(errorResponse),
        'utf8',
      );

      recordRequest({
        timestamp: startTime,
        method: 'POST',
        path: '/api/playrecords',
        statusCode: 401,
        duration: Date.now() - startTime,
        memoryUsed:
          (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize: 0,
        responseSize: errorSize,
      });

      return NextResponse.json(errorResponse, { status: 401 });
    }

    const config = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username,
      );
      if (!user) {
        const errorResponse = { error: '用户不存在' };
        const errorSize = Buffer.byteLength(
          JSON.stringify(errorResponse),
          'utf8',
        );

        recordRequest({
          timestamp: startTime,
          method: 'POST',
          path: '/api/playrecords',
          statusCode: 401,
          duration: Date.now() - startTime,
          memoryUsed:
            (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
          dbQueries: getDbQueryCount(),
          requestSize: 0,
          responseSize: errorSize,
        });

        return NextResponse.json(errorResponse, { status: 401 });
      }
      if (user.banned) {
        const errorResponse = { error: '用户已被封禁' };
        const errorSize = Buffer.byteLength(
          JSON.stringify(errorResponse),
          'utf8',
        );

        recordRequest({
          timestamp: startTime,
          method: 'POST',
          path: '/api/playrecords',
          statusCode: 401,
          duration: Date.now() - startTime,
          memoryUsed:
            (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
          dbQueries: getDbQueryCount(),
          requestSize: 0,
          responseSize: errorSize,
        });

        return NextResponse.json(errorResponse, { status: 401 });
      }
    }

    const body = await request.json();
    const requestSize = Buffer.byteLength(JSON.stringify(body), 'utf8');
    const { key, record }: { key: string; record: PlayRecord } = body;

    if (!key || !record) {
      const errorResponse = { error: 'Missing key or record' };
      const errorSize = Buffer.byteLength(
        JSON.stringify(errorResponse),
        'utf8',
      );

      recordRequest({
        timestamp: startTime,
        method: 'POST',
        path: '/api/playrecords',
        statusCode: 400,
        duration: Date.now() - startTime,
        memoryUsed:
          (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize,
        responseSize: errorSize,
      });

      return NextResponse.json(errorResponse, { status: 400 });
    }

    // 验证播放记录数据
    if (!record.title || !record.source_name || record.index < 1) {
      const errorResponse = { error: 'Invalid record data' };
      const errorSize = Buffer.byteLength(
        JSON.stringify(errorResponse),
        'utf8',
      );

      recordRequest({
        timestamp: startTime,
        method: 'POST',
        path: '/api/playrecords',
        statusCode: 400,
        duration: Date.now() - startTime,
        memoryUsed:
          (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize,
        responseSize: errorSize,
      });

      return NextResponse.json(errorResponse, { status: 400 });
    }

    const identity = resolvePlayRecordIdentity(key);
    if (!identity) {
      const errorResponse = { error: playRecordIdentityError(key) };
      const errorSize = Buffer.byteLength(
        JSON.stringify(errorResponse),
        'utf8',
      );

      recordRequest({
        timestamp: startTime,
        method: 'POST',
        path: '/api/playrecords',
        statusCode: 400,
        duration: Date.now() - startTime,
        memoryUsed:
          (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize,
        responseSize: errorSize,
      });

      return NextResponse.json(errorResponse, { status: 400 });
    }

    // 获取现有播放记录以保持原始集数
    const { source, id } = identity;
    const existingRecord = await db.getPlayRecord(
      authInfo.username,
      source,
      id,
    );
    const playbackFacts = playbackFactsOnly(record);

    const finalRecord = {
      ...playbackFacts,
      save_time: record.save_time ?? Date.now(),
      ...(existingRecord?.original_episodes !== undefined
        ? { original_episodes: existingRecord.original_episodes }
        : {}),
    } as PlayRecord;

    await db.savePlayRecord(authInfo.username, source, id, finalRecord);

    // 更新播放统计（如果存储类型支持）
    if (db.isStatsSupported()) {
      await db.updatePlayStatistics(
        authInfo.username,
        source,
        id,
        finalRecord.play_time,
      );
    }

    const successResponse = { success: true };
    const responseSize = Buffer.byteLength(
      JSON.stringify(successResponse),
      'utf8',
    );

    recordRequest({
      timestamp: startTime,
      method: 'POST',
      path: '/api/playrecords',
      statusCode: 200,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize,
      responseSize,
    });

    return NextResponse.json(successResponse, { status: 200 });
  } catch (err) {
    console.error('保存播放记录失败', err);
    const errorResponse = { error: 'Internal Server Error' };
    const errorSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'POST',
      path: '/api/playrecords',
      statusCode: 500,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize: errorSize,
    });

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  resetDbQueryCount();

  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      const errorResponse = { error: 'Unauthorized' };
      const errorSize = Buffer.byteLength(
        JSON.stringify(errorResponse),
        'utf8',
      );

      recordRequest({
        timestamp: startTime,
        method: 'DELETE',
        path: '/api/playrecords',
        statusCode: 401,
        duration: Date.now() - startTime,
        memoryUsed:
          (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
        dbQueries: getDbQueryCount(),
        requestSize: 0,
        responseSize: errorSize,
      });

      return NextResponse.json(errorResponse, { status: 401 });
    }

    const config = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username,
      );
      if (!user) {
        const errorResponse = { error: '用户不存在' };
        const errorSize = Buffer.byteLength(
          JSON.stringify(errorResponse),
          'utf8',
        );

        recordRequest({
          timestamp: startTime,
          method: 'DELETE',
          path: '/api/playrecords',
          statusCode: 401,
          duration: Date.now() - startTime,
          memoryUsed:
            (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
          dbQueries: getDbQueryCount(),
          requestSize: 0,
          responseSize: errorSize,
        });

        return NextResponse.json(errorResponse, { status: 401 });
      }
      if (user.banned) {
        const errorResponse = { error: '用户已被封禁' };
        const errorSize = Buffer.byteLength(
          JSON.stringify(errorResponse),
          'utf8',
        );

        recordRequest({
          timestamp: startTime,
          method: 'DELETE',
          path: '/api/playrecords',
          statusCode: 401,
          duration: Date.now() - startTime,
          memoryUsed:
            (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
          dbQueries: getDbQueryCount(),
          requestSize: 0,
          responseSize: errorSize,
        });

        return NextResponse.json(errorResponse, { status: 401 });
      }
    }

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 如果提供了 key，删除单条播放记录
      const identity = resolvePlayRecordIdentity(key);
      if (!identity) {
        const errorResponse = { error: playRecordIdentityError(key) };
        const errorSize = Buffer.byteLength(
          JSON.stringify(errorResponse),
          'utf8',
        );

        recordRequest({
          timestamp: startTime,
          method: 'DELETE',
          path: '/api/playrecords',
          statusCode: 400,
          duration: Date.now() - startTime,
          memoryUsed:
            (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
          dbQueries: getDbQueryCount(),
          requestSize: 0,
          responseSize: errorSize,
        });

        return NextResponse.json(errorResponse, { status: 400 });
      }

      await db.deletePlayRecord(username, identity.source, identity.id);
      await db.deleteWatchingFollow(username, identity.source, identity.id);
      await updateCheckService.onFollowDeleted(
        username,
        identity.source,
        identity.id,
      );
    } else {
      // 未提供 key，则清空全部播放记录
      // 目前 DbManager 没有对应方法，这里直接遍历删除
      const all = await db.getAllPlayRecords(username);
      await Promise.all(
        Object.keys(all).map(async (key) => {
          const identity = parsePlayRecordStorageKey(key);
          if (identity) {
            await db.deletePlayRecord(username, identity.source, identity.id);
          }
        }),
      );
      const follows = await db.getAllWatchingFollows(username);
      await Promise.all(
        Object.values(follows).map((follow) =>
          Promise.all([
            db.deleteWatchingFollow(username, follow.source, follow.id),
            updateCheckService.onFollowDeleted(
              username,
              follow.source,
              follow.id,
            ),
          ]),
        ),
      );
    }

    const successResponse = { success: true };
    const responseSize = Buffer.byteLength(
      JSON.stringify(successResponse),
      'utf8',
    );

    recordRequest({
      timestamp: startTime,
      method: 'DELETE',
      path: '/api/playrecords',
      statusCode: 200,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize,
    });

    return NextResponse.json(successResponse, { status: 200 });
  } catch (err) {
    console.error('删除播放记录失败', err);
    const errorResponse = { error: 'Internal Server Error' };
    const errorSize = Buffer.byteLength(JSON.stringify(errorResponse), 'utf8');

    recordRequest({
      timestamp: startTime,
      method: 'DELETE',
      path: '/api/playrecords',
      statusCode: 500,
      duration: Date.now() - startTime,
      memoryUsed: (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024,
      dbQueries: getDbQueryCount(),
      requestSize: 0,
      responseSize: errorSize,
    });

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
