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
    // 【墓碑重设计·修改】客户端传入的 updatedAt 不再作为决胜依据（仅作
    // API 兼容字段忽略）。旧实现用客户端时钟做 last-write-wins：两端时钟
    // 偏差下，旧数据可凭超前的客户端时间戳反超新数据（含删除墓碑），这是
    // 「删除复活」bug 的根因之一。现在版本裁决全部由服务端时钟盖章
    // （见下方 stamped），冲突语义 = 服务端接收顺序 LWW。

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
              record: existing || { remark: '', updatedAt: 0, origin },
              ignored: true,
            },
          };
        }

        // 自动日期备注不允许覆盖手动备注/墓碑（墓碑 origin 为 manual），
        // 与各端 saveBangumiDateRemarkIfAllowed 的客户端守卫一致。
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

      // 【墓碑重设计·新增】服务端权威盖章：所有落库时间戳由服务端时钟产生
      // 并保证单调递增（不小于既有记录 +1，兼容存量客户端时钟时间戳超前
      // 的记录，也容忍服务器时钟回拨）。
      const stamped = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);

      // 先清掉 canonical/legacy 双键，防止 legacy 影子键残留干扰后续查找。
      deleteRemarkEntries(remarks, source, id);

      if (remark) {
        // 活记录：正常 upsert。若此前是墓碑，此处不携带 deletedAt 即自然
        // 清除墓碑——用户主动重写备注是显式复活动作，覆盖墓碑属预期语义。
        remarks[key] = { remark, updatedAt: stamped, origin };
      } else {
        // 【墓碑重设计·新增】空 remark + manual origin = 删除意图的 POST
        // 通道（与 DELETE 等价）：写显式墓碑（deletedAt），供各端统一按
        // 「墓碑无条件获胜」的合并契约传播删除意图。bangumi 空 remark 已
        // 在上方守卫提前返回，到达此处的空 remark 必为 manual。
        remarks[key] = {
          remark: '',
          updatedAt: stamped,
          origin: MANUAL_ORIGIN,
          deletedAt: stamped,
        };
      }

      return {
        status: 200,
        payload: {
          success: true,
          record: remarks[key],
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
    // 【墓碑重设计·修改】DELETE 不再接受/比较 updatedAt：真实客户端
    //（App 的 _deleteRemoteRecord 与 Web 的 deleteVideoRemark）从不携带
    // 该参数，此前它引发两类 bug——旧实现无参数时回退服务器时钟与客户端
    // 时间戳跨时钟域比较（时间偏差即可静默跳过删除却返回 success，见
    // 8238c8db 修复）；有参数时又会在服务端盖章时间戳（必然大于任何
    // 客户端所见版本）后永远拒绝删除。删除语义简化为：无条件删除 + 写
    // 显式墓碑（deletedAt），删除幂等且无信息可丢，无需版本守卫。

    await updateRemarks(user.username, (remarks) => {
      if (source && id) {
        const lookup = resolveRemarkEntry(remarks, source, id);
        const existing = lookup?.record;

        deleteRemarkEntries(remarks, source, id);
        // 【墓碑重设计·修改】显式墓碑（remark:'' + deletedAt，与 POST 空
        // remark 通道写入的形状完全一致）：只物理删除记录无法跨设备传播
        // 删除意图——其他端的本地旧副本会在下一次同步按 local-wins 把
        // 记录重新上传，「删除了过一会儿又回来」。墓碑无条件传播删除意图，
        // 时间戳取 max(服务器时钟, 原记录+1)：必须大于被删记录的时间戳
        // （该值可能来自存量数据的客户端时钟、超前于服务器），否则墓碑
        // 在合并时赢不过其他端的旧副本。无既有记录时也写墓碑：把删除
        // 意图传播给仍持有本地副本的旧客户端。用户之后重新保存备注时，
        // 新记录由 POST 通道盖章覆盖墓碑，正常复活。
        const tombstoneKey = resolveRemarkWriteKey(source, id);
        if (tombstoneKey) {
          const stamped = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
          remarks[tombstoneKey] = {
            remark: '',
            updatedAt: stamped,
            origin: MANUAL_ORIGIN,
            deletedAt: stamped,
          };
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
