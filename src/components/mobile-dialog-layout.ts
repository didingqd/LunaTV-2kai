// Keeps portrait-phone dialog sizing aligned without changing landscape or desktop layouts.
export const MOBILE_DIALOG_FRAME_CLASS =
  'portrait:max-md:inset-x-auto portrait:max-md:left-1/2 portrait:max-md:right-auto portrait:max-md:w-[calc(100%-2rem)] portrait:max-md:max-w-xl portrait:max-md:max-h-[calc(100dvh-4rem)] portrait:max-md:-translate-x-1/2';

export const MOBILE_DIALOG_CONTENT_CLASS =
  'portrait:max-md:p-6 portrait:max-md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]';

export const MOBILE_DIALOG_HEADER_CLASS =
  'portrait:max-md:min-h-10 portrait:max-md:items-center portrait:max-md:gap-3 portrait:max-md:mb-6';
