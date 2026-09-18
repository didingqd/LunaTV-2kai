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
  normalizeTagList,
  readTags,
  resolveTagEntry,
  resolveTagWriteKey,
  updateTags,
  type VideoTagRecord,
} from '@/lib/video-tags.server';

export const runtime = 'nodejs';

/**
 * 【自定义标签·新增】视频自定义标签同步 API。
 *
 * 与 /api/remarks 同构（鉴权、性能记录、服务端时钟盖章、显式墓碑传播删除），
 * 去掉 origin/bangumi/admin 推送。App 端 VideoTagService 消费此接口做双端同步：
 * - GET  /api/videotags                → 全量 Record<canonicalKey, VideoTagRecord>
 * - GET  /api/videotags?source=&id=    → 单条记录
 * - POST /api/videotags {source,id,tags[]} → 规整后 upsert；空 tags 写墓碑
 * - DELETE /api/videotags?source=&id=  → 无条件写墓碑（幂等）
 */

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
    path: '/api/videotags',
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
      const tags = await readTags(user.username);
      const lookup = resolveTagEntry(tags, source, id);
      const record: VideoTagRecord = lookup?.record || {
        tags: [],
        updatedAt: 0,
      };
      return jsonResponse('GET', startTime, startMemory, 200, 0, record);
    }

    const tags = await readTags(user.username);
    return jsonResponse('GET', startTime, startMemory, 200, 0, tags);
  } catch (err) {
    console.error('获取视频标签失败', err);
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
    // 规整标签（trim/去重/长度上限/数量上限，超量静默截断）。客户端传入的
    // updatedAt 不参与裁决——版本裁决全部由服务端时钟盖章（见下方 stamped）。
    const tags = normalizeTagList(body.tags);

    if (!source || !id) {
      return jsonResponse('POST', startTime, startMemory, 400, requestSize, {
        error: 'Missing source or id',
      });
    }

    const result = await updateTags(user.username, (tagsMap) => {
      const key = resolveTagWriteKey(source, id);
      if (!key) {
        return {
          status: 400,
          payload: { error: 'Invalid source or id' },
        };
      }
      const existing = tagsMap[key];

      // 服务端权威盖章：落库时间戳由服务端时钟产生并保证单调递增（不小于既有
      // 记录 +1，兼容存量客户端时钟超前的记录，也容忍服务器时钟回拨）。
      const stamped = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);

      if (tags.length > 0) {
        // 活记录：正常 upsert。若此前是墓碑，此处不携带 deletedAt 即自然复活。
        tagsMap[key] = { tags, updatedAt: stamped };
      } else {
        // 空 tags = 删除意图（与 DELETE 等价）：写显式墓碑，供各端按「墓碑无
        // 条件获胜」的合并契约传播删除意图。
        tagsMap[key] = { tags: [], updatedAt: stamped, deletedAt: stamped };
      }

      return {
        status: 200,
        payload: { success: true, record: tagsMap[key] },
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
    console.error('保存视频标签失败', err);
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

    await updateTags(user.username, (tagsMap) => {
      if (source && id) {
        const key = resolveTagWriteKey(source, id);
        if (key) {
          const existing = tagsMap[key];
          // 无条件写显式墓碑（幂等）：只物理删除无法跨设备传播删除意图，其他端
          // 的本地旧副本会在下一次同步按 local-wins 重新上传。墓碑时间戳取
          // max(服务器时钟, 原记录+1)，必须大于被删记录时间戳才能在合并时获胜。
          const stamped = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
          tagsMap[key] = { tags: [], updatedAt: stamped, deletedAt: stamped };
        }
        return;
      }

      // 无参 DELETE（全量清空）：逐键写显式墓碑，让「全量删除」按统一契约传播
      // 到所有端（不物理清空，避免持有旧副本的端把数据重传回来）。
      const usedKeys = Object.keys(tagsMap);
      for (const key of usedKeys) {
        const existing = tagsMap[key];
        const stamped = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
        tagsMap[key] = { tags: [], updatedAt: stamped, deletedAt: stamped };
      }
    });

    return jsonResponse('DELETE', startTime, startMemory, 200, 0, {
      success: true,
    });
  } catch (err) {
    console.error('删除视频标签失败', err);
    return jsonResponse('DELETE', startTime, startMemory, 500, 0, {
      error: 'Internal Server Error',
    });
  }
}
