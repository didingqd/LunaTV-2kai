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
  deleteRemarkEntries,
  MANUAL_ORIGIN,
  normalizeOrigin,
  readRemarks,
  resolveRemarkEntry,
  resolveRemarkWriteKey,
  updateRemarks,
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
    // 【修复·删除被静默跳过】真实客户端（App 的 _deleteRemoteRecord 与 Web 的
    // deleteVideoRemark）发 DELETE 时都不携带 updatedAt。旧实现回退到服务器时钟
    // Date.now()，而记录里的 updatedAt 是保存时由「客户端时钟」写入的——这是
    // 跨时钟域比较：只要客户端时钟超前（或服务器时钟落后）的时间差大于
    // 「保存→删除」的间隔，existing.updatedAt > Date.now() 成立，删除被静默
    // 跳过却仍返回 success:true。客户端随即清掉 pending delete，下一次同步又
    // 把远端记录拉回本地，表现为「删除了但实际没有被删除」。
    // 现在 last-write-wins 守卫只在调用方显式携带 updatedAt（其所见版本）时
    // 生效；未携带或非法时视为无条件删除（+∞ 恒满足 <= 比较），与两条真实
    // 客户端路径的语义一致。
    const updatedAtParam = request.nextUrl.searchParams.get('updatedAt');
    const parsedUpdatedAt = updatedAtParam ? Number(updatedAtParam) : NaN;
    const updatedAt = Number.isFinite(parsedUpdatedAt)
      ? parsedUpdatedAt
      : Number.POSITIVE_INFINITY;

    await updateRemarks(user.username, (remarks) => {
      if (source && id) {
        const lookup = resolveRemarkEntry(remarks, source, id);
        const existing = lookup?.record;

        if (!existing || existing.updatedAt <= updatedAt) {
          deleteRemarkEntries(remarks, source, id);
          // 【新增·删除墓碑（tombstone）】只物理删除记录无法跨设备传播删除
          // 意图：其他端（如网页浏览器 localStorage、另一台 App 设备）的本地
          // 副本会在下一次同步时发现「本地有、远端没有」，按 local-wins 规则
          // 把记录重新上传回服务器，表现为「删除了过一会儿又回来」。这里在
          // 删除后写入一条空备注墓碑（remark:''，origin manual），时间戳取
          // max(服务器时钟, 原记录 updatedAt+1)——必须大于被删记录的时间戳
          // （该值来自客户端时钟，可能超前于服务器），否则墓碑在合并时赢不
          // 过其他端的旧副本。各端合并逻辑按时间戳比较，墓碑获胜后本地副本
          // 被覆盖为空、显示为无备注，且不满足 local-wins 条件而不再重传。
          // 用户之后重新保存备注时，新记录时间戳更新，正常覆盖墓碑。
          const tombstoneKey = resolveRemarkWriteKey(source, id);
          if (existing && tombstoneKey) {
            remarks[tombstoneKey] = {
              remark: '',
              updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
              origin: MANUAL_ORIGIN,
            };
          }
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
