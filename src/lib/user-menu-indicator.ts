import { UpdateStatus, type UpdateStatus as UpdateStatusType } from '@/lib/version_check';

export function getSeekKeyboardDelta({
  altKey,
  key,
  seekSeconds,
}: {
  altKey: boolean;
  key: string;
  seekSeconds: number;
}) {
  if (altKey) {
    return null;
  }

  if (key === 'ArrowLeft') {
    return -seekSeconds;
  }

  if (key === 'ArrowRight') {
    return seekSeconds;
  }

  return null;
}

export function getUserMenuIndicatorColor({
  hasActualUpdates,
  updateStatus,
}: {
  hasActualUpdates: boolean;
  updateStatus: UpdateStatusType | null;
}) {
  if (updateStatus === UpdateStatus.HAS_UPDATE) {
    return 'yellow';
  }

  if (hasActualUpdates) {
    return 'red';
  }

  return null;
}
