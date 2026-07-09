'use client';

import { Megaphone } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { useSite } from './SiteProvider';

const STANDALONE_ROUTES = [
  '/login',
  '/register',
  '/oidc-register',
  '/warning',
  '/source-test',
  '/watch-room/screen',
];
const MARQUEE_PIXELS_PER_SECOND = 48;

function isStandaloneRoute(pathname: string) {
  return STANDALONE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export default function UserNotificationBar() {
  const pathname = usePathname();
  const { userNotification } = useSite();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(24);
  const text = userNotification?.trim();

  useEffect(() => {
    if (!text) return;

    let rafId = 0;
    let timeoutId = 0;
    let cancelled = false;

    const updateScrollState = () => {
      const container = containerRef.current;
      const textElement = textRef.current;
      if (!container || !textElement) return;

      const textWidth = textElement.scrollWidth;
      setShouldScroll(textWidth > container.clientWidth + 8);
      setDurationSeconds(textWidth / MARQUEE_PIXELS_PER_SECOND);
    };

    const scheduleUpdate = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(updateScrollState);
    };

    scheduleUpdate();
    timeoutId = window.setTimeout(scheduleUpdate, 250);

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleUpdate);
    if (containerRef.current) resizeObserver?.observe(containerRef.current);
    if (textRef.current) resizeObserver?.observe(textRef.current);

    document.fonts?.ready.then(() => {
      if (!cancelled) scheduleUpdate();
    });

    window.addEventListener('resize', scheduleUpdate);
    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (timeoutId) window.clearTimeout(timeoutId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [text]);

  if (!text || isStandaloneRoute(pathname)) return null;

  return (
    <div className='fixed left-0 right-0 top-11 md:top-16 z-40 h-6 border-b border-green-200/70 bg-green-50/95 text-green-900 shadow-sm backdrop-blur-md dark:border-green-900/50 dark:bg-green-950/90 dark:text-green-100'>
      <div className='mx-auto flex h-full max-w-[2560px] items-center gap-2 px-4 text-xs sm:px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-20'>
        <div className='flex shrink-0 items-center gap-1 font-medium text-green-700 dark:text-green-300'>
          <Megaphone className='h-3.5 w-3.5' />
          <span>通知</span>
        </div>
        <div ref={containerRef} className='min-w-0 flex-1 overflow-hidden'>
          <div
            className={`inline-flex w-max whitespace-nowrap user-notification-marquee ${
              shouldScroll ? 'is-scrolling' : ''
            }`}
            style={
              shouldScroll
                ? ({
                    '--notification-marquee-duration': `${durationSeconds}s`,
                  } as CSSProperties)
                : undefined
            }
          >
            <span className='inline-flex items-center'>
              <span ref={textRef}>{text}</span>
            </span>
            {shouldScroll && (
              <span className='inline-flex items-center' aria-hidden='true'>
                <span>{text}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
