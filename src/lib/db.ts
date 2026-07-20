/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { KvrocksStorage } from './kvrocks.db';
import { SqliteStorage } from './sqlite.db';
import { RedisStorage } from './redis.db';
import {
  ContentStat,
  EpisodeSkipConfig,
  Favorite,
  IStorage,
  PlayRecord,
  PlayStatsResult,
  Reminder,
  SkipConfig,
  UserPlayStat,
  WatchingFollow,
} from './types';
import { UpstashRedisStorage } from './upstash.db';
import { incrementDbQuery } from './performance-monitor';
import {
  parsePlayRecordStorageKey,
  playRecordStorageKey,
} from './play-record';
import {
  comparePlayRecordIdentity,
  normalizePlayRecordIdentity,
  resolvePlayRecordIdentity,
} from './play-record-identity';
import {
  assertWatchingFollowCanBeStored,
  migrateStoredWatchingFollow,
  watchingFollowStorageKey,
} from './watching-follow';
import { buildContentIdentityKey, compareContentIdentity } from './content-identity';
import {
  findFavoriteReminderIdentityEntry,
  normalizeFavoriteReminderRecord,
} from './favorite-reminder-identity';

// storage type 常量: 'localstorage' | 'redis' | 'upstash'，默认 'localstorage'
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | 'sqlite'
    | undefined) || 'localstorage';

// 创建存储实例
function createStorage(): IStorage {
  switch (STORAGE_TYPE) {
    case 'redis':
      return new RedisStorage();
    case 'upstash':
      return new UpstashRedisStorage();
    case 'kvrocks':
      return new KvrocksStorage();
    case 'sqlite':
      if (process.env.EDGEONE_PAGES === '1') {
        throw new Error(
          '[LunaTV] SQLite storage is not supported on EdgeOne Pages: the platform has no persistent filesystem. ' +
            'Please set NEXT_PUBLIC_STORAGE_TYPE to "upstash", "redis", or "kvrocks".',
        );
      }
      return new SqliteStorage();
    case 'localstorage':
    default:
      return null as unknown as IStorage;
  }
}

// 单例存储实例
let storageInstance: IStorage | null = null;

function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

// 工具函数：生成存储key
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 导出便捷方法
export class DbManager {
  private storage: IStorage;

  constructor(storage?: IStorage) {
    this.storage = storage ?? getStorage();
    // 启动时自动触发数据迁移（异步，不阻塞构造）
    if (
      this.storage &&
      typeof (this.storage as any).migrateData === 'function'
    ) {
      (this.storage as any)
        .migrateData()
        .then(async () => {
          if (typeof (this.storage as any).migratePasswords === 'function') {
            await (this.storage as any).migratePasswords();
          }
        })
        .catch((err: any) => {
          console.error('数据迁移异常:', err);
        });
    }
  }

  // 播放记录相关方法
  async getPlayRecord(
    userName: string,
    source: string,
    id: string,
  ): Promise<PlayRecord | null> {
    incrementDbQuery();
    const identity = normalizePlayRecordIdentity(source, id);
    if (!identity) return null;
    const key = identity.canonicalKey;
    const current = await this.storage.getPlayRecord(userName, key);
    if (current) return current;

    const legacyKey = identity.legacyKey;
    if (!legacyKey) return null;
    const legacyIdentity = resolvePlayRecordIdentity(legacyKey);
    if (!comparePlayRecordIdentity(legacyIdentity, identity)) return null;
    const legacy = await this.storage.getPlayRecord(userName, legacyKey);
    if (!legacy) return null;
    await this.storage.setPlayRecord(userName, key, legacy);
    return legacy;
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord,
  ): Promise<void> {
    incrementDbQuery();
    const key = playRecordStorageKey(source, id);
    await this.storage.setPlayRecord(userName, key, record);
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    incrementDbQuery();
    const stored = await this.storage.getAllPlayRecords(userName);
    const result: Record<string, PlayRecord> = {};

    for (const [storedKey, record] of Object.entries(stored)) {
      const identity = resolvePlayRecordIdentity(storedKey);
      if (!identity || identity.format !== 'canonical') continue;
      result[identity.canonicalKey] = record;
    }

    for (const [storedKey, record] of Object.entries(stored)) {
      const identity = resolvePlayRecordIdentity(storedKey);
      if (!identity || identity.format !== 'legacy') continue;
      const key = identity.canonicalKey;
      if (!(key in result)) {
        result[key] = record;
        await this.storage.setPlayRecord(userName, key, record);
      }
    }

    return result;
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    incrementDbQuery();
    const identity = normalizePlayRecordIdentity(source, id);
    if (!identity) return;
    await this.storage.deletePlayRecord(userName, identity.canonicalKey);
    if (
      identity.legacyKey &&
      comparePlayRecordIdentity(identity.legacyKey, identity)
    ) {
      await this.storage.deletePlayRecord(userName, identity.legacyKey);
    }
  }

  // 🚀 批量保存播放记录（Upstash 优化，使用 mset 只算1条命令）
  async savePlayRecordsBatch(
    userName: string,
    records: Array<{ source: string; id: string; record: PlayRecord }>,
  ): Promise<void> {
    if (records.length === 0) return;

    // 检查 storage 是否支持批量操作
    if (typeof this.storage.setPlayRecordsBatch === 'function') {
      incrementDbQuery();
      const batchData: { [key: string]: PlayRecord } = {};
      for (const { source, id, record } of records) {
        const key = playRecordStorageKey(source, id);
        batchData[key] = record;
      }
      await this.storage.setPlayRecordsBatch(userName, batchData);
    } else {
      // 回退：逐条保存
      for (const { source, id, record } of records) {
        await this.savePlayRecord(userName, source, id, record);
      }
    }
  }

  // 收藏相关方法
  async getFavorite(
    userName: string,
    source: string,
    id: string,
  ): Promise<Favorite | null> {
    incrementDbQuery();
    const key = buildContentIdentityKey(source, id);
    const current = await this.storage.getFavorite(userName, key);
    if (current) return current;

    const stored = await this.storage.getAllFavorites(userName);
    const legacy = findFavoriteReminderIdentityEntry(stored, { source, id });
    if (!legacy) return null;
    if (legacy.key !== key) {
      await this.storage.setFavorite(userName, key, legacy.value);
      await this.storage.deleteFavorite(userName, legacy.key);
    }
    return legacy.value;
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite,
  ): Promise<void> {
    incrementDbQuery();
    const key = buildContentIdentityKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(
    userName: string,
  ): Promise<{ [key: string]: Favorite }> {
    incrementDbQuery();
    const stored = await this.storage.getAllFavorites(userName);
    const normalized = normalizeFavoriteReminderRecord(stored);
    for (const migration of normalized.migrations) {
      if (migration.writeCanonical) {
        await this.storage.setFavorite(
          userName,
          migration.identityKey,
          migration.value,
        );
      }
      await this.storage.deleteFavorite(userName, migration.storedKey);
    }
    return normalized.values;
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    incrementDbQuery();
    const key = buildContentIdentityKey(source, id);
    await this.storage.deleteFavorite(userName, key);
    const stored = await this.storage.getAllFavorites(userName);
    await Promise.all(
      Object.keys(stored)
        .filter((storedKey) =>
          compareContentIdentity({ key: storedKey }, { source, id }),
        )
        .map((storedKey) =>
          this.storage.deleteFavorite(userName, storedKey),
        ),
    );
  }

  // ==================== 提醒相关方法 ====================

  async getReminder(
    userName: string,
    source: string,
    id: string,
  ): Promise<Reminder | null> {
    incrementDbQuery();
    const key = buildContentIdentityKey(source, id);
    const current = await this.storage.getReminder(userName, key);
    if (current) return current;

    const stored = await this.storage.getAllReminders(userName);
    const legacy = findFavoriteReminderIdentityEntry(stored, { source, id });
    if (!legacy) return null;
    if (legacy.key !== key) {
      await this.storage.setReminder(userName, key, legacy.value);
      await this.storage.deleteReminder(userName, legacy.key);
    }
    return legacy.value;
  }

  async saveReminder(
    userName: string,
    source: string,
    id: string,
    reminder: Reminder,
  ): Promise<void> {
    incrementDbQuery();
    const key = buildContentIdentityKey(source, id);
    await this.storage.setReminder(userName, key, reminder);
  }

  async getAllReminders(
    userName: string,
  ): Promise<{ [key: string]: Reminder }> {
    incrementDbQuery();
    const stored = await this.storage.getAllReminders(userName);
    const normalized = normalizeFavoriteReminderRecord(stored);
    for (const migration of normalized.migrations) {
      if (migration.writeCanonical) {
        await this.storage.setReminder(
          userName,
          migration.identityKey,
          migration.value,
        );
      }
      await this.storage.deleteReminder(userName, migration.storedKey);
    }
    return normalized.values;
  }

  async deleteReminder(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    incrementDbQuery();
    const key = buildContentIdentityKey(source, id);
    await this.storage.deleteReminder(userName, key);
    const stored = await this.storage.getAllReminders(userName);
    await Promise.all(
      Object.keys(stored)
        .filter((storedKey) =>
          compareContentIdentity({ key: storedKey }, { source, id }),
        )
        .map((storedKey) =>
          this.storage.deleteReminder(userName, storedKey),
        ),
    );
  }

  // ==================== 追更关注相关方法 ====================

  async getWatchingFollow(
    userName: string,
    source: string,
    id: string,
  ): Promise<WatchingFollow | null> {
    incrementDbQuery();
    const identity = normalizePlayRecordIdentity(source, id);
    if (!identity) return null;
    const key = identity.canonicalKey;
    const current = await this.storage.getWatchingFollow(userName, key);
    if (current) {
      return this.migrateWatchingFollowValue(userName, key, current);
    }

    const legacyKey = identity.legacyKey;
    if (!legacyKey) return null;
    const legacy = await this.storage.getWatchingFollow(userName, legacyKey);
    if (!legacy) return null;
    const migrated = migrateStoredWatchingFollow(legacy);
    if (!migrated || !comparePlayRecordIdentity(migrated, identity)) {
      return null;
    }
    await this.storage.setWatchingFollow(userName, key, migrated);
    return migrated;
  }

  async saveWatchingFollow(
    userName: string,
    source: string,
    id: string,
    follow: WatchingFollow,
  ): Promise<void> {
    incrementDbQuery();
    const key = watchingFollowStorageKey(source, id);
    const rawExisting = await this.storage.getWatchingFollow(userName, key);
    const existing = rawExisting
      ? await this.migrateWatchingFollowValue(userName, key, rawExisting)
      : null;
    assertWatchingFollowCanBeStored(existing, source, id, follow);

    await this.storage.setWatchingFollow(userName, key, follow);
  }

  async getAllWatchingFollows(
    userName: string,
  ): Promise<{ [key: string]: WatchingFollow }> {
    incrementDbQuery();
    const stored = await this.storage.getAllWatchingFollows(userName);
    const result: Record<string, WatchingFollow> = {};

    for (const [storedKey, raw] of Object.entries(stored)) {
      const identity = resolvePlayRecordIdentity(storedKey);
      if (!identity || identity.format !== 'canonical') continue;
      const follow = await this.migrateWatchingFollowValue(
        userName,
        storedKey,
        raw,
      );
      if (!comparePlayRecordIdentity(follow, identity)) continue;
      result[identity.canonicalKey] = follow;
    }

    for (const [storedKey, raw] of Object.entries(stored)) {
      const storedIdentity = resolvePlayRecordIdentity(storedKey);
      if (storedIdentity?.format === 'canonical') continue;
      const follow = migrateStoredWatchingFollow(raw);
      if (!follow) continue;
      const key = watchingFollowStorageKey(follow.source, follow.id);
      if (key in result) continue;
      result[key] = follow;
      const existing = await this.storage.getWatchingFollow(userName, key);
      if (!existing)
        await this.storage.setWatchingFollow(userName, key, follow);
    }
    return result;
  }

  async deleteWatchingFollow(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    incrementDbQuery();
    const identity = normalizePlayRecordIdentity(source, id);
    if (!identity) return;
    await this.storage.deleteWatchingFollow(userName, identity.canonicalKey);
    if (identity.legacyKey) {
      const legacy = await this.storage.getWatchingFollow(
        userName,
        identity.legacyKey,
      );
      const legacyFollow = migrateStoredWatchingFollow(legacy);
      if (legacyFollow && comparePlayRecordIdentity(legacyFollow, identity)) {
        await this.storage.deleteWatchingFollow(
          userName,
          identity.legacyKey,
        );
      }
    }
  }

  private migrateWatchingFollowValue(
    userName: string,
    key: string,
    raw: WatchingFollow,
  ): Promise<WatchingFollow> {
    const migrated = migrateStoredWatchingFollow(raw);
    if (!migrated) throw new Error('Invalid WatchingFollow storage value');
    if (JSON.stringify(raw) !== JSON.stringify(migrated)) {
      return this.storage
        .setWatchingFollow(userName, key, migrated)
        .then(() => migrated);
    }
    return Promise.resolve(migrated);
  }

  // 🚀 批量保存收藏（Upstash 优化，使用 mset 只算1条命令）
  async saveFavoritesBatch(
    userName: string,
    favorites: Array<{ source: string; id: string; favorite: Favorite }>,
  ): Promise<void> {
    if (favorites.length === 0) return;

    // 检查 storage 是否支持批量操作
    if (typeof this.storage.setFavoritesBatch === 'function') {
      incrementDbQuery();
      const batchData: { [key: string]: Favorite } = {};
      for (const { source, id, favorite } of favorites) {
        const key = buildContentIdentityKey(source, id);
        batchData[key] = favorite;
      }
      await this.storage.setFavoritesBatch(userName, batchData);
    } else {
      // 回退：逐条保存
      for (const { source, id, favorite } of favorites) {
        await this.saveFavorite(userName, source, id, favorite);
      }
    }
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string,
  ): Promise<boolean> {
    incrementDbQuery();
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  // ---------- 用户相关 ----------
  async registerUser(userName: string, password: string): Promise<void> {
    incrementDbQuery();
    await this.storage.registerUser(userName, password);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    incrementDbQuery();
    return this.storage.verifyUser(userName, password);
  }

  // 检查用户是否已存在
  async checkUserExist(userName: string): Promise<boolean> {
    incrementDbQuery();
    return this.storage.checkUserExist(userName);
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    incrementDbQuery();
    await this.storage.changePassword(userName, newPassword);
  }

  async deleteUser(userName: string): Promise<void> {
    incrementDbQuery();
    await this.storage.deleteUser(userName);
  }

  // ---------- 用户相关（新版本 V2，支持 OIDC） ----------
  async createUserV2(
    userName: string,
    password: string,
    role: 'owner' | 'admin' | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[],
  ): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).createUserV2 === 'function') {
      await (this.storage as any).createUserV2(
        userName,
        password,
        role,
        tags,
        oidcSub,
        enabledApis,
      );
    }
  }

  async verifyUserV2(userName: string, password: string): Promise<boolean> {
    incrementDbQuery();
    if (typeof (this.storage as any).verifyUserV2 === 'function') {
      return (this.storage as any).verifyUserV2(userName, password);
    }
    return false;
  }

  async checkUserExistV2(userName: string): Promise<boolean> {
    incrementDbQuery();
    if (typeof (this.storage as any).checkUserExistV2 === 'function') {
      return (this.storage as any).checkUserExistV2(userName);
    }
    return false;
  }

  async getUserByOidcSub(oidcSub: string): Promise<string | null> {
    incrementDbQuery();
    if (typeof (this.storage as any).getUserByOidcSub === 'function') {
      return (this.storage as any).getUserByOidcSub(oidcSub);
    }
    return null;
  }

  async getUserInfoV2(userName: string): Promise<{
    username: string;
    role: 'owner' | 'admin' | 'user';
    tags?: string[];
    enabledApis?: string[];
    banned?: boolean;
    createdAt?: number;
    oidcSub?: string;
  } | null> {
    incrementDbQuery();
    if (typeof (this.storage as any).getUserInfoV2 === 'function') {
      return (this.storage as any).getUserInfoV2(userName);
    }
    return null;
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    incrementDbQuery();
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    incrementDbQuery();
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    incrementDbQuery();
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // 获取全部用户名
  async getAllUsers(): Promise<string[]> {
    incrementDbQuery();
    if (typeof (this.storage as any).getAllUsers === 'function') {
      return (this.storage as any).getAllUsers();
    }
    return [];
  }

  // ---------- 管理员配置 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    incrementDbQuery();
    if (typeof (this.storage as any).getAdminConfig === 'function') {
      return (this.storage as any).getAdminConfig();
    }
    return null;
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).setAdminConfig === 'function') {
      await (this.storage as any).setAdminConfig(config);
    }
  }

  // ---------- 跳过片头片尾配置 ----------
  async getSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<SkipConfig | null> {
    incrementDbQuery();
    if (typeof (this.storage as any).getSkipConfig === 'function') {
      return (this.storage as any).getSkipConfig(userName, source, id);
    }
    return null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig,
  ): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).setSkipConfig === 'function') {
      await (this.storage as any).setSkipConfig(userName, source, id, config);
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).deleteSkipConfig === 'function') {
      await (this.storage as any).deleteSkipConfig(userName, source, id);
    }
  }

  async getAllSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: SkipConfig }> {
    incrementDbQuery();
    if (typeof (this.storage as any).getAllSkipConfigs === 'function') {
      return (this.storage as any).getAllSkipConfigs(userName);
    }
    return {};
  }

  // ---------- 剧集跳过配置（兼容旧接口命名，底层已收敛到 SkipConfig）----------
  async getEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<EpisodeSkipConfig | null> {
    incrementDbQuery();
    if (typeof (this.storage as any).getEpisodeSkipConfig === 'function') {
      return (this.storage as any).getEpisodeSkipConfig(userName, source, id);
    }
    return null;
  }

  async saveEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: EpisodeSkipConfig,
  ): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).saveEpisodeSkipConfig === 'function') {
      await (this.storage as any).saveEpisodeSkipConfig(
        userName,
        source,
        id,
        config,
      );
    }
  }

  async deleteEpisodeSkipConfig(
    userName: string,
    source: string,
    id: string,
  ): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).deleteEpisodeSkipConfig === 'function') {
      await (this.storage as any).deleteEpisodeSkipConfig(userName, source, id);
    }
  }

  async getAllEpisodeSkipConfigs(
    userName: string,
  ): Promise<{ [key: string]: EpisodeSkipConfig }> {
    incrementDbQuery();
    if (typeof (this.storage as any).getAllEpisodeSkipConfigs === 'function') {
      return (this.storage as any).getAllEpisodeSkipConfigs(userName);
    }
    return {};
  }

  // ---------- 数据清理 ----------
  async clearAllData(): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).clearAllData === 'function') {
      await (this.storage as any).clearAllData();
    } else {
      throw new Error('存储类型不支持清空数据操作');
    }
  }

  // ---------- 通用缓存方法 ----------
  async getCache(key: string): Promise<any | null> {
    incrementDbQuery();
    if (typeof this.storage.getCache === 'function') {
      return await this.storage.getCache(key);
    }
    return null;
  }

  async setCache(
    key: string,
    data: any,
    expireSeconds?: number,
  ): Promise<void> {
    incrementDbQuery();
    if (typeof this.storage.setCache === 'function') {
      await this.storage.setCache(key, data, expireSeconds);
    }
  }

  async deleteCache(key: string): Promise<void> {
    incrementDbQuery();
    if (typeof this.storage.deleteCache === 'function') {
      await this.storage.deleteCache(key);
    }
  }

  async clearExpiredCache(prefix?: string): Promise<void> {
    incrementDbQuery();
    if (typeof this.storage.clearExpiredCache === 'function') {
      await this.storage.clearExpiredCache(prefix);
    }
  }

  // ---------- 播放统计相关 ----------
  async getPlayStats(): Promise<PlayStatsResult> {
    incrementDbQuery();
    if (typeof (this.storage as any).getPlayStats === 'function') {
      return (this.storage as any).getPlayStats();
    }

    // 如果存储不支持统计功能，返回默认值
    return {
      totalUsers: 0,
      totalWatchTime: 0,
      totalPlays: 0,
      avgWatchTimePerUser: 0,
      avgPlaysPerUser: 0,
      userStats: [],
      topSources: [],
      dailyStats: [],
      // 新增：用户注册统计
      registrationStats: {
        todayNewUsers: 0,
        totalRegisteredUsers: 0,
        registrationTrend: [],
      },
      // 新增：用户活跃度统计
      activeUsers: {
        daily: 0,
        weekly: 0,
        monthly: 0,
      },
    };
  }

  async getUserPlayStat(userName: string): Promise<UserPlayStat> {
    incrementDbQuery();
    if (typeof (this.storage as any).getUserPlayStat === 'function') {
      return (this.storage as any).getUserPlayStat(userName);
    }

    // 如果存储不支持统计功能，返回默认值
    return {
      username: userName,
      totalWatchTime: 0,
      totalPlays: 0,
      lastPlayTime: 0,
      recentRecords: [],
      avgWatchTime: 0,
      mostWatchedSource: '',
    };
  }

  async getContentStats(limit = 10): Promise<ContentStat[]> {
    incrementDbQuery();
    if (typeof (this.storage as any).getContentStats === 'function') {
      return (this.storage as any).getContentStats(limit);
    }

    // 如果存储不支持统计功能，返回空数组
    return [];
  }

  async updatePlayStatistics(
    _userName: string,
    _source: string,
    _id: string,
    _watchTime: number,
  ): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).updatePlayStatistics === 'function') {
      await (this.storage as any).updatePlayStatistics(
        _userName,
        _source,
        _id,
        _watchTime,
      );
    }
  }

  async updateUserLoginStats(
    userName: string,
    loginTime: number,
    isFirstLogin?: boolean,
    loginMeta?: {
      ip?: string;
      location?: string;
      device?: string;
      browser?: string;
      os?: string;
    },
  ): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).updateUserLoginStats === 'function') {
      await (this.storage as any).updateUserLoginStats(
        userName,
        loginTime,
        isFirstLogin,
        loginMeta,
      );
    }
  }

  // 删除 V1 用户密码数据（用于 V1→V2 迁移）
  async deleteV1Password(userName: string): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).client !== 'undefined') {
      await (this.storage as any).client.del(`u:${userName}:pwd`);
    }
  }

  // 检查存储类型是否支持统计功能
  isStatsSupported(): boolean {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    return storageType !== 'localstorage';
  }

  // 用户 Emby 配置相关方法
  async getUserEmbyConfig(userName: string): Promise<any | null> {
    incrementDbQuery();
    if (typeof (this.storage as any).getUserEmbyConfig === 'function') {
      return (this.storage as any).getUserEmbyConfig(userName);
    }
    return null;
  }

  async saveUserEmbyConfig(userName: string, config: any): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).saveUserEmbyConfig === 'function') {
      await (this.storage as any).saveUserEmbyConfig(userName, config);
    }
  }

  async deleteUserEmbyConfig(userName: string): Promise<void> {
    incrementDbQuery();
    if (typeof (this.storage as any).deleteUserEmbyConfig === 'function') {
      await (this.storage as any).deleteUserEmbyConfig(userName);
    }
  }

  // 崩溃日志相关方法
  async saveCrashLog(crashLog: any): Promise<void> {
    incrementDbQuery();
    await this.storage.saveCrashLog(crashLog);
  }

  async getCrashLogs(limit?: number): Promise<any[]> {
    incrementDbQuery();
    return this.storage.getCrashLogs(limit);
  }

  async deleteCrashLog(timestamp: string): Promise<void> {
    incrementDbQuery();
    await this.storage.deleteCrashLog(timestamp);
  }

  async clearCrashLogs(): Promise<void> {
    incrementDbQuery();
    await this.storage.clearCrashLogs();
  }
}

// 导出默认实例
export const db = new DbManager();
export const dbManager = db; // 别名，方便使用
