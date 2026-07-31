export interface NotificationSnapshot {
  followId: string;
  episode: number;
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
  episode: number;
}

export interface WatchingUpdateChange {
  followId: string;
  title: string;
  fromEpisode: number;
  toEpisode: number;
}

export interface WatchingUpdateHistory extends WatchingUpdateChange {
  updatedAt: string;
}

export interface UpdateDiffAnalysis {
  newUpdates: WatchingUpdateChange[];
  updatedHistory: WatchingUpdateHistory[];
  nextState: WatchingUpdateNotificationState;
}
