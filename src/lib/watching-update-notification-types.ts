export interface NotificationSnapshot {
  followId: string;
  lastNotifiedEffectiveLatestEpisode: number;
}

export interface NotificationHistory {
  followId: string;
  fromEpisode: number;
  toEpisode: number;
  updatedAt: string;
}

export interface WatchingUpdateNotificationState {
  snapshots: NotificationSnapshot[];
  history: NotificationHistory[];
}

export interface WatchingUpdateNotificationCandidate {
  followId: string;
  title: string;
  fromEpisode: number;
  toEpisode: number;
  hasUpdate: boolean;
}

export interface WatchingUpdateChange {
  followId: string;
  title: string;
  fromEpisode: number;
  toEpisode: number;
}

export interface UpdateDiffAnalysis {
  newUpdates: WatchingUpdateChange[];
  updated: WatchingUpdateChange[];
  nextState: WatchingUpdateNotificationState;
}
