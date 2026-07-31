import { readFileSync } from 'fs';
import { join } from 'path';

describe('UserMenu notification center entry', () => {
  it('exposes the notification center route and unread badge wiring', () => {
    const source = readFileSync(join(__dirname, 'UserMenu.tsx'), 'utf8');

    expect(source).toContain('/notifications');
    expect(source).toContain('/notification-settings');
    expect(source).toContain('/api/user/notifications');
    expect(source).toContain('notificationUnread');
    expect(source).toContain('handleNotifications');
    expect(source).toContain('handleNotificationSettings');
  });
});
