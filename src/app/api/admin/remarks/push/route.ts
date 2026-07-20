/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { ensureAdmin } from '@/lib/admin-auth';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  MANUAL_ORIGIN,
  RemarksMap,
  getConfigUsernames,
  pushManualRemarksToUsers,
  readRemarks,
  resolveRemarkEntry,
  writeRemarks,
} from '@/lib/video-remarks.server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await ensureAdmin(request);

    const authInfo = getAuthInfoFromCookie(request);
    const username = authInfo?.username;
    if (!username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const id = typeof body.id === 'string' ? body.id.trim() : '';

    const config = await getConfig();
    const targetUsernames = getConfigUsernames(config);
    const allRemarks = await readRemarks(username);
    let sourceRemarks: RemarksMap | undefined;

    if (source || id) {
      if (!source || !id) {
        return NextResponse.json(
          { error: 'source 和 id 必须同时提供' },
          { status: 400 },
        );
      }

      const lookup = resolveRemarkEntry(allRemarks, source, id);
      if (lookup?.migrated) {
        await writeRemarks(username, allRemarks);
      }
      const record = lookup?.record;
      if (!record || record.origin !== MANUAL_ORIGIN || !record.remark.trim()) {
        return NextResponse.json(
          { error: '当前条目没有可推送的手动备注' },
          { status: 400 },
        );
      }
      sourceRemarks = { [lookup.key]: record };
    }

    const result = await pushManualRemarksToUsers(
      username,
      targetUsernames,
      sourceRemarks,
    );

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    console.error('推送备注失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '推送备注失败' },
      { status: 500 },
    );
  }
}
