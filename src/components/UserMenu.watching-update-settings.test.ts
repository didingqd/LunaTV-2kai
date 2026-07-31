import { readFileSync } from 'fs';
import { join } from 'path';

describe('UserMenu watching update settings entry', () => {
  it('embeds watching update settings inside the follows modal', () => {
    const source = readFileSync(join(__dirname, 'UserMenu.tsx'), 'utf8');

    expect(source).toContain('watchingFollowsTab');
    expect(source).toContain('WatchingUpdateSettingsPage embedded');
    expect(source).toContain('追更列表');
    expect(source).toContain('追更设置');
    expect(source).not.toContain("href: '/watching-updates/settings'");
    expect(source).not.toContain('追更系统设置');
    expect(source).not.toContain('handleWatchingUpdateSettings');
  });
});
