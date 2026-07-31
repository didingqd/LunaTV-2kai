import { readFileSync } from 'fs';
import { join } from 'path';

describe('UserMenu watching update settings entry', () => {
  it('exposes the user watching update settings route', () => {
    const source = readFileSync(join(__dirname, 'UserMenu.tsx'), 'utf8');

    expect(source).toContain('/watching-updates/settings');
    expect(source).toContain('追更系统设置');
    expect(source).toContain('handleWatchingUpdateSettings');
  });
});
