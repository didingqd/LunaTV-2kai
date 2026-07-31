import { readFileSync } from 'fs';
import { join } from 'path';

describe('UserMenu notification center entry', () => {
  it('opens notification center as an integrated modal with settings', () => {
    const source = readFileSync(join(__dirname, 'UserMenu.tsx'), 'utf8');

    expect(source).toContain('/api/user/notifications');
    expect(source).toContain('notificationUnread');
    expect(source).toContain('handleNotifications');
    expect(source).toContain('isNotificationsOpen');
    expect(source).toContain('notificationsPanel');
    expect(source).toContain('NotificationCenterPage embedded');
    expect(source).toContain('NotificationSettingsPage embedded');
    expect(source).toContain('通知列表');
    expect(source).toContain('通知设置');
    expect(source).not.toContain("href: '/notification-settings'");
    expect(source).not.toContain('handleNotificationSettings');
  });
});
