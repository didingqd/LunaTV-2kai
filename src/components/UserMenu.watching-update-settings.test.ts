import { readFileSync } from 'fs';
import { join } from 'path';

describe('UserMenu watching update settings entry', () => {
  it('embeds follows and settings inside the existing watching updates modal', () => {
    const source = readFileSync(join(__dirname, 'UserMenu.tsx'), 'utf8');

    expect(source).toContain('watchingUpdatesPanel');
    expect(source).toContain('watchingUpdatesTab');
    expect(source).toContain('更新提醒');
    expect(source).toContain('我的追更');
    expect(source).toContain('WatchingUpdateSettingsPage embedded');
    expect(source).toContain('追更列表');
    expect(source).toContain('追更设置');
    expect(source).toContain('watchingFollowKey(follow.source, follow.id)');
    expect(source).toContain("from='follow'");
    expect(source).toContain('handleDismissRelease');
    expect(source).not.toContain('watchingFollowsPanel');
    expect(source).not.toContain('isWatchingFollowsOpen');
    expect(source).not.toContain("href: '/watching-updates/settings'");
    expect(source).not.toContain('追更系统设置');
    expect(source).not.toContain('handleWatchingUpdateSettings');
  });
});
