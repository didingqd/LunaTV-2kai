import type { AdminConfig } from './admin.types';
import { getOwnerStatus, hasEffectiveOwner } from './owner-status';

describe('owner status detection', () => {
  const originalUsername = process.env.USERNAME;

  afterEach(() => {
    if (originalUsername === undefined) {
      delete process.env.USERNAME;
    } else {
      process.env.USERNAME = originalUsername;
    }
  });

  it('reports the legacy ENV owner as the current effective owner', () => {
    const status = getOwnerStatus({ envUsername: 'mike' });

    expect(status).toEqual({
      hasOwner: true,
      sources: ['env'],
      ownerUsers: [
        {
          username: 'mike',
          sources: ['env'],
          effective: true,
        },
      ],
    });
    expect(hasEffectiveOwner({ envUsername: 'mike' })).toBe(true);
  });

  it('reports database owner users as diagnostic candidates only', () => {
    const status = getOwnerStatus({
      envUsername: null,
      databaseUsers: [{ username: 'alice', role: 'owner' }],
    });

    expect(status).toEqual({
      hasOwner: false,
      sources: ['database'],
      ownerUsers: [
        {
          username: 'alice',
          sources: ['database'],
          effective: false,
        },
      ],
    });
  });

  it('reports AdminConfig owner users as diagnostic candidates only', () => {
    const status = getOwnerStatus({
      envUsername: null,
      adminConfig: config([{ username: 'bob', role: 'owner' }]),
    });

    expect(status).toEqual({
      hasOwner: false,
      sources: ['config'],
      ownerUsers: [
        {
          username: 'bob',
          sources: ['config'],
          effective: false,
        },
      ],
    });
  });

  it('merges sources for the same username without changing ENV effectiveness', () => {
    const status = getOwnerStatus({
      envUsername: 'mike',
      databaseUsers: [{ username: 'mike', role: 'owner' }],
      adminConfig: config([{ username: 'mike', role: 'owner' }]),
    });

    expect(status).toEqual({
      hasOwner: true,
      sources: ['env', 'database', 'config'],
      ownerUsers: [
        {
          username: 'mike',
          sources: ['env', 'database', 'config'],
          effective: true,
        },
      ],
    });
  });

  it('uses process.env.USERNAME when envUsername is not provided', () => {
    process.env.USERNAME = 'legacy';

    expect(getOwnerStatus().ownerUsers).toEqual([
      {
        username: 'legacy',
        sources: ['env'],
        effective: true,
      },
    ]);
  });
});

function config(
  users: AdminConfig['UserConfig']['Users'],
): AdminConfig {
  return {
    UserConfig: { Users: users },
  } as AdminConfig;
}

