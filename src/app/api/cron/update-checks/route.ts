import { NextRequest, NextResponse } from 'next/server';

import { updateCheckScheduler } from '@/lib/update-check-scheduler';

export const runtime = 'nodejs';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await updateCheckScheduler.run();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Update check scheduler failed', error);
    return NextResponse.json(
      { success: false, error: 'Update check scheduler failed' },
      { status: 500 },
    );
  }
}
