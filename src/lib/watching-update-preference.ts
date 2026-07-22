export type WatchingUpdateSourceMode = 'local' | 'backend';

export const WATCHING_UPDATE_SOURCE_MODE_KEY =
  'moontv_watching_update_source_mode_v1';

const PREFERENCE_EVENT = 'moontv:watching-update-source-mode';

export function readWatchingUpdateSourceMode(
  storage?: Pick<Storage, 'getItem'>,
): WatchingUpdateSourceMode {
  if (!storage && typeof window === 'undefined') return 'local';
  const value = (storage ?? window.localStorage).getItem(
    WATCHING_UPDATE_SOURCE_MODE_KEY,
  );
  return value === 'backend' ? 'backend' : 'local';
}

export function writeWatchingUpdateSourceMode(
  mode: WatchingUpdateSourceMode,
  storage?: Pick<Storage, 'setItem'>,
): void {
  (storage ?? window.localStorage).setItem(
    WATCHING_UPDATE_SOURCE_MODE_KEY,
    mode,
  );
  if (!storage && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }
}

export function subscribeWatchingUpdateSourceMode(
  listener: () => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === WATCHING_UPDATE_SOURCE_MODE_KEY) listener();
  };
  window.addEventListener(PREFERENCE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
