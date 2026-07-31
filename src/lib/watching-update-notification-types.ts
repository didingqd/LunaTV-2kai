export interface UpdateCheckSnapshot {
  id: string;
  title: string;
  episode: number;
}

export interface UpdateHistory {
  id: string;
  title: string;
  fromEpisode: number;
  toEpisode: number;
  updatedAt: string;
}

export interface WatchingUpdateNotificationState {
  snapshots: UpdateCheckSnapshot[];
  history: UpdateHistory[];
}

export interface WatchingUpdateChange {
  id: string;
  title: string;
  fromEpisode: number;
  toEpisode: number;
}

export interface UpdateDiffAnalysis {
  newUpdates: WatchingUpdateChange[];
  updatedHistory: UpdateHistory[];
  nextState: WatchingUpdateNotificationState;
}
