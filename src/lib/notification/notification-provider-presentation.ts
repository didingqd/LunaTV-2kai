export interface NotificationProviderPresentation {
  description: string;
  icon: string;
}

/**
 * Presentation metadata deliberately owns only API/UI display hints. Provider
 * availability, schemas, validation, testing and send capability stay
 * authoritative in NotificationProviderRegistry and concrete providers.
 */
export const NOTIFICATION_PROVIDER_PRESENTATIONS: Record<
  string,
  NotificationProviderPresentation
> = {
  inbox: {
    description: '\u5728 LunaTV \u7ad9\u5185\u901a\u77e5\u4e2d\u5fc3\u63a5\u6536\u6d88\u606f\u3002',
    icon: 'inbox',
  },
  wechat_work: {
    description: '\u53d1\u9001\u901a\u77e5\u5230\u4f01\u4e1a\u5fae\u4fe1\u7fa4\u673a\u5668\u4eba\u3002',
    icon: 'building-2',
  },
  webhook: {
    description: 'HTTP POST \u63a8\u9001\u3002',
    icon: 'link',
  },
  telegram: {
    description: 'Telegram Bot \u63a8\u9001\u3002',
    icon: 'send',
  },
  bark: {
    description: 'Bark iOS \u63a8\u9001\u3002',
    icon: 'smartphone',
  },
  pushplus: {
    description: 'PushPlus \u63a8\u9001\u3002',
    icon: 'message-circle',
  },
  serverchan3: {
    description: 'Server\u9171 Turbo \u63a8\u9001\u3002',
    icon: 'bell-ring',
  },
  dingtalk: {
    description: '\u9489\u9489\u7fa4\u673a\u5668\u4eba\u63a8\u9001\u3002',
    icon: 'bot',
  },
  lark: {
    description: '\u98de\u4e66\u7fa4\u673a\u5668\u4eba\u63a8\u9001\u3002',
    icon: 'message-square',
  },
  wecom: {
    description: '\u4f01\u4e1a\u5fae\u4fe1\u673a\u5668\u4eba Key \u63a8\u9001\u3002',
    icon: 'building-2',
  },
  notifyx: {
    description: 'NotifyX \u805a\u5408\u63a8\u9001\u3002',
    icon: 'bell',
  },
  resend: {
    description: '\u90ae\u4ef6\u901a\u77e5\u3002',
    icon: 'mail',
  },
  gotify: {
    description: 'Gotify \u81ea\u6258\u7ba1\u63a8\u9001\u3002',
    icon: 'bell',
  },
  ntfy: {
    description: 'ntfy \u4e3b\u9898\u63a8\u9001\u3002',
    icon: 'radio',
  },
};

const unknownProviderPresentation: NotificationProviderPresentation = {
  description: '\u6b64\u901a\u77e5\u6e20\u9053\u6682\u672a\u63d0\u4f9b\u989d\u5916\u5c55\u793a\u4fe1\u606f\u3002',
  icon: 'bell',
};

export function getNotificationProviderPresentation(
  type: string,
): NotificationProviderPresentation {
  return NOTIFICATION_PROVIDER_PRESENTATIONS[type] ?? unknownProviderPresentation;
}
