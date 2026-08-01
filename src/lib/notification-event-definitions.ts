import { NOTIFICATION_TEST_EVENT_TYPE } from './notification-test-event';
import {
  WATCHING_UPDATE_FAILED_EVENT_TYPE,
  WATCHING_UPDATE_FOUND_EVENT_TYPE,
} from './watching-update-notification-events';

export const SCHEDULER_FAILED_EVENT_TYPE = 'scheduler.failed';
export const SYSTEM_ERROR_EVENT_TYPE = 'system.error';

export const APPLICATION_NOTIFICATION_EVENT_METAS = [
  {
    type: WATCHING_UPDATE_FOUND_EVENT_TYPE,
    label: '追更更新',
    description: '关注的影视内容发现新集或新季时通知。',
    category: 'watching',
    defaultSubscribed: true,
  },
  {
    type: WATCHING_UPDATE_FAILED_EVENT_TYPE,
    label: '更新失败',
    description: '追更检查或更新过程失败时通知。',
    category: 'watching',
    defaultSubscribed: true,
  },
  {
    type: SCHEDULER_FAILED_EVENT_TYPE,
    label: '调度失败',
    description: '后台定时任务执行失败时通知。',
    category: 'system',
  },
  {
    type: SYSTEM_ERROR_EVENT_TYPE,
    label: '系统错误',
    description: '系统级错误通知。',
    category: 'system',
  },
  {
    type: NOTIFICATION_TEST_EVENT_TYPE,
    label: '测试通知',
    description: '用于验证通知链路的测试通知。',
    category: 'system',
  },
];

export const DEFAULT_APPLICATION_NOTIFICATION_SUBSCRIBED_EVENTS =
  APPLICATION_NOTIFICATION_EVENT_METAS.filter(
    (eventMeta) => eventMeta.defaultSubscribed,
  ).map((eventMeta) => eventMeta.type);

export { NOTIFICATION_TEST_EVENT_TYPE };
