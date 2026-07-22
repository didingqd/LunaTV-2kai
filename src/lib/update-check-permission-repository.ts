import { db } from './db';

export interface UpdateCheckUserPermission {
  userId: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  operator: string;
}

export interface UpdateCheckPermissionStore {
  getCache(key: string): Promise<unknown | null>;
  setCache(key: string, data: unknown, expireSeconds?: number): Promise<void>;
}

export interface UpdateCheckUserPermissionRepository {
  get(userId: string): Promise<UpdateCheckUserPermission | null>;
  getAll(): Promise<UpdateCheckUserPermission[]>;
  save(permission: UpdateCheckUserPermission): Promise<void>;
  listEnabledUserIds(): Promise<string[]>;
}

const PERMISSIONS_KEY = 'watching-update:permissions:v1';

function asPermissions(value: unknown): UpdateCheckUserPermission[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is UpdateCheckUserPermission =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as UpdateCheckUserPermission).userId === 'string' &&
      typeof (item as UpdateCheckUserPermission).enabled === 'boolean',
  );
}

export class CachedUpdateCheckUserPermissionRepository implements UpdateCheckUserPermissionRepository {
  private writeQueue = Promise.resolve();

  constructor(private readonly store: UpdateCheckPermissionStore = db) {}

  async get(userId: string): Promise<UpdateCheckUserPermission | null> {
    return (
      (await this.getAll()).find(
        (permission) => permission.userId === userId,
      ) ?? null
    );
  }

  async getAll(): Promise<UpdateCheckUserPermission[]> {
    return asPermissions(await this.store.getCache(PERMISSIONS_KEY));
  }

  async save(permission: UpdateCheckUserPermission): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const permissions = (await this.getAll()).filter(
        (item) => item.userId !== permission.userId,
      );
      permissions.push(permission);
      permissions.sort((left, right) =>
        left.userId.localeCompare(right.userId),
      );
      await this.store.setCache(PERMISSIONS_KEY, permissions);
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  async listEnabledUserIds(): Promise<string[]> {
    return (await this.getAll())
      .filter((permission) => permission.enabled)
      .map((permission) => permission.userId);
  }
}

export const updateCheckUserPermissionRepository =
  new CachedUpdateCheckUserPermissionRepository();
