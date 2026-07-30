export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.VERCEL === '1') return;

  const { schedulerManager } = await import(
    '@/lib/scheduler/scheduler-manager'
  );
  schedulerManager.start();
}
