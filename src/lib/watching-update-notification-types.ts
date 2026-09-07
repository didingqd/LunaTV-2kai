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
  // 修改点：新增可选 sourceName，用于在推送消息中展示资源站名称（如“如意资源”）
  sourceName?: string;
}

export interface WatchingUpdateChange {
  followId: string;
  title: string;
  fromEpisode: number;
  toEpisode: number;
  // 修改点：新增可选 sourceName，用于在推送消息中展示资源站名称（如“如意资源”）
  sourceName?: string;
}

export interface UpdateDiffAnalysis {
  newUpdates: WatchingUpdateChange[];
  updated: WatchingUpdateChange[];
  nextState: WatchingUpdateNotificationState;
}
