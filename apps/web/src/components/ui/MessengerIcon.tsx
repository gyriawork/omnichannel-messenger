'use client';

import { cn } from '@/lib/utils';

type MessengerType = 'telegram' | 'slack' | 'whatsapp' | 'gmail';

interface MessengerIconProps {
  messenger: MessengerType;
  size?: number;
  className?: string;
}

function TelegramSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="none">
      <circle cx="24" cy="24" r="24" fill="#2AABEE" />
      <path
        d="M10.6 23.4c6.6-2.9 11-4.8 13.2-5.7 6.3-2.6 7.6-3.1 8.5-3.1.2 0 .6 0 .8.3.2.2.3.5.3.7 0 .3 0 .5-.1.8-.5 5.4-2.7 18.5-3.8 24.5-.5 2.6-1.4 3.4-2.3 3.5-2 .2-3.5-1.3-5.4-2.6-3-2-4.7-3.2-7.6-5.2-3.3-2.3-.6-3.5 1.7-5.5.5-.5 8.8-8.1 9-8.8 0-.1 0-.3-.1-.4-.2-.1-.4-.1-.5 0-.3.1-4.2 2.7-11.8 7.9-1.1.8-2.1 1.1-3 1.1-1 0-2.9-.6-4.3-1-1.7-.6-3.1-.9-3-1.8.1-.5.7-1 2-1.6z"
        fill="#fff"
      />
    </svg>
  );
}

function SlackSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="none">
      <rect width="48" height="48" rx="12" fill="#611F69" />
      <path d="M18.4 28.8a2.4 2.4 0 1 1-2.4-2.4h2.4v2.4zm1.2 0a2.4 2.4 0 1 1 4.8 0v6a2.4 2.4 0 1 1-4.8 0v-6z" fill="#E01E5A" />
      <path d="M22 18.4a2.4 2.4 0 1 1-2.4-2.4 2.4 2.4 0 0 1 2.4 2.4zm0 1.2a2.4 2.4 0 1 1 0 4.8h-6a2.4 2.4 0 1 1 0-4.8h6z" fill="#36C5F0" />
      <path d="M31.6 22a2.4 2.4 0 1 1 2.4-2.4v2.4h-2.4zm-1.2 0a2.4 2.4 0 1 1-4.8 0v-6a2.4 2.4 0 1 1 4.8 0v6z" fill="#2EB67D" />
      <path d="M28 31.6a2.4 2.4 0 1 1 2.4 2.4H28v-2.4zm0-1.2a2.4 2.4 0 1 1 0-4.8h6a2.4 2.4 0 1 1 0 4.8h-6z" fill="#ECB22E" />
    </svg>
  );
}

function WhatsAppSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="none">
      <circle cx="24" cy="24" r="24" fill="#25D366" />
      <path
        d="M34.6 13.4A14.8 14.8 0 0 0 24 9a14.9 14.9 0 0 0-13 22.1L9 39l8.1-2.1A14.9 14.9 0 0 0 39 24a14.8 14.8 0 0 0-4.4-10.6zM24 36.2a12.3 12.3 0 0 1-6.3-1.7l-.5-.3-4.8 1.3 1.3-4.6-.3-.5A12.4 12.4 0 1 1 24 36.2zm6.8-9.3c-.4-.2-2.2-1.1-2.6-1.2-.3-.1-.6-.2-.8.2-.3.4-1 1.2-1.2 1.4-.2.3-.5.3-.8.1-.4-.2-1.6-.6-3-1.8a11.5 11.5 0 0 1-2.1-2.5c-.2-.4 0-.6.2-.8l.5-.6.3-.4.2-.4v-.4l-1-2.3c-.3-.6-.5-.5-.8-.5h-.7a1.3 1.3 0 0 0-1 .5A4 4 0 0 0 17.4 22c0 2.3 1.7 4.6 2 5 .2.2 3.3 5 8 7a27 27 0 0 0 2.7 1 6.4 6.4 0 0 0 3-.2c.9-.1 2.2-.9 2.6-1.8.3-.9.3-1.6.2-1.8-.1-.2-.4-.3-.8-.5z"
        fill="#fff"
      />
    </svg>
  );
}

function GmailSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} fill="none">
      <rect width="48" height="48" rx="12" fill="#EA4335" />
      <path d="M12 16l12 9 12-9v16H12V16z" fill="#fff" />
      <path d="M12 16l12 9 12-9" stroke="#EA4335" strokeWidth="2" fill="none" />
    </svg>
  );
}

const ICON_MAP: Record<MessengerType, React.FC<{ size: number }>> = {
  telegram: TelegramSvg,
  slack: SlackSvg,
  whatsapp: WhatsAppSvg,
  gmail: GmailSvg,
};

export function MessengerIcon({ messenger, size = 24, className }: MessengerIconProps) {
  const Icon = ICON_MAP[messenger];
  if (!Icon) return null;
  return (
    <span className={cn('inline-flex flex-shrink-0', className)}>
      <Icon size={size} />
    </span>
  );
}
