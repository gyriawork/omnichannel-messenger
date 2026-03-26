'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Plug,
  Unplug,
  X,
  Loader2,
  Info,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useIntegrations,
  useConnectIntegration,
  useDisconnectIntegration,
  useReconnectIntegration,
} from '@/hooks/useIntegrations';
import type { Integration, IntegrationStatus, MessengerType } from '@/types/integration';

// ---------- Messenger metadata ----------

interface MessengerInfo {
  key: MessengerType;
  name: string;
  abbr: string;
  description: string;
  bgClass: string;
  textClass: string;
  badgeBg: string;
}

const messengers: MessengerInfo[] = [
  {
    key: 'telegram',
    name: 'Telegram',
    abbr: 'TG',
    description: 'Send and receive messages via Telegram user account',
    bgClass: 'bg-messenger-tg-bg',
    textClass: 'text-messenger-tg-text',
    badgeBg: 'bg-messenger-tg-bg',
  },
  {
    key: 'slack',
    name: 'Slack',
    abbr: 'SL',
    description: 'Connect to Slack workspaces and channels',
    bgClass: 'bg-messenger-sl-bg',
    textClass: 'text-messenger-sl-text',
    badgeBg: 'bg-messenger-sl-bg',
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    abbr: 'WA',
    description: 'Message contacts via WhatsApp Web pairing',
    bgClass: 'bg-messenger-wa-bg',
    textClass: 'text-messenger-wa-text',
    badgeBg: 'bg-messenger-wa-bg',
  },
  {
    key: 'gmail',
    name: 'Gmail',
    abbr: 'GM',
    description: 'Read and send emails through your Gmail account',
    bgClass: 'bg-messenger-gm-bg',
    textClass: 'text-messenger-gm-text',
    badgeBg: 'bg-messenger-gm-bg',
  },
];

// ---------- Status helpers ----------

function statusConfig(status: IntegrationStatus) {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        dotClass: 'bg-emerald-500',
        badgeClass: 'bg-emerald-50 text-emerald-700',
        icon: CheckCircle2,
      };
    case 'disconnected':
      return {
        label: 'Disconnected',
        dotClass: 'bg-slate-400',
        badgeClass: 'bg-slate-100 text-slate-600',
        icon: XCircle,
      };
    case 'token_expired':
      return {
        label: 'Token Expired',
        dotClass: 'bg-amber-500',
        badgeClass: 'bg-amber-50 text-amber-700',
        icon: AlertTriangle,
      };
    case 'session_expired':
      return {
        label: 'Session Expired',
        dotClass: 'bg-red-500',
        badgeClass: 'bg-red-50 text-red-700',
        icon: AlertTriangle,
      };
  }
}

function formatDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------- Zod schemas for connect forms ----------

const telegramSchema = z.object({
  apiId: z.string().min(1, 'API ID is required'),
  apiHash: z.string().min(1, 'API Hash is required'),
});

const slackSchema = z.object({
  botToken: z.string().min(1, 'Bot Token is required').startsWith('xoxb-', 'Must start with xoxb-'),
});

const gmailSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  refreshToken: z.string().min(1, 'Refresh Token is required'),
});

// ---------- Connect modals ----------

function TelegramConnectForm({
  onSubmit,
  isPending,
}: {
  onSubmit: (data: z.infer<typeof telegramSchema>) => void;
  isPending: boolean;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof telegramSchema>>({
    resolver: zodResolver(telegramSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          API ID
        </label>
        <input
          {...register('apiId')}
          placeholder="Enter your Telegram API ID"
          className={cn(
            'w-full rounded border-[1.5px] border-slate-200 px-3 py-2 text-sm transition-colors',
            'placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
            errors.apiId && 'border-red-300 focus:border-red-400 focus:ring-red-100',
          )}
        />
        {errors.apiId && (
          <p className="mt-1 text-xs text-red-500">{errors.apiId.message}</p>
        )}
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          API Hash
        </label>
        <input
          {...register('apiHash')}
          type="password"
          placeholder="Enter your Telegram API Hash"
          className={cn(
            'w-full rounded border-[1.5px] border-slate-200 px-3 py-2 text-sm transition-colors',
            'placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
            errors.apiHash && 'border-red-300 focus:border-red-400 focus:ring-red-100',
          )}
        />
        {errors.apiHash && (
          <p className="mt-1 text-xs text-red-500">{errors.apiHash.message}</p>
        )}
      </div>
      <div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <p className="text-xs text-blue-700">
          After connecting, you will need to complete phone number verification
          in a separate step.
        </p>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded bg-accent px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:-translate-y-px disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plug className="h-4 w-4" />
        )}
        Connect Telegram
      </button>
    </form>
  );
}

function SlackConnectForm({
  onSubmit,
  isPending,
}: {
  onSubmit: (data: z.infer<typeof slackSchema>) => void;
  isPending: boolean;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof slackSchema>>({
    resolver: zodResolver(slackSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Bot Token
        </label>
        <input
          {...register('botToken')}
          type="password"
          placeholder="xoxb-your-bot-token"
          className={cn(
            'w-full rounded border-[1.5px] border-slate-200 px-3 py-2 text-sm font-mono transition-colors',
            'placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
            errors.botToken && 'border-red-300 focus:border-red-400 focus:ring-red-100',
          )}
        />
        {errors.botToken && (
          <p className="mt-1 text-xs text-red-500">{errors.botToken.message}</p>
        )}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded bg-accent px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:-translate-y-px disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plug className="h-4 w-4" />
        )}
        Connect Slack
      </button>
    </form>
  );
}

function WhatsAppConnectForm({
  onSubmit,
  isPending,
}: {
  onSubmit: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-xs text-emerald-700">
          WhatsApp uses QR code pairing. After clicking Connect, a QR code will
          appear. Scan it with WhatsApp on your phone to link this device.
        </p>
      </div>
      <button
        onClick={onSubmit}
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded bg-accent px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:-translate-y-px disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plug className="h-4 w-4" />
        )}
        Start QR Pairing
      </button>
    </div>
  );
}

function GmailConnectForm({
  onSubmit,
  isPending,
}: {
  onSubmit: (data: z.infer<typeof gmailSchema>) => void;
  isPending: boolean;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof gmailSchema>>({
    resolver: zodResolver(gmailSchema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Client ID
        </label>
        <input
          {...register('clientId')}
          placeholder="your-client-id.apps.googleusercontent.com"
          className={cn(
            'w-full rounded border-[1.5px] border-slate-200 px-3 py-2 text-sm transition-colors',
            'placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
            errors.clientId && 'border-red-300 focus:border-red-400 focus:ring-red-100',
          )}
        />
        {errors.clientId && (
          <p className="mt-1 text-xs text-red-500">{errors.clientId.message}</p>
        )}
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Client Secret
        </label>
        <input
          {...register('clientSecret')}
          type="password"
          placeholder="Enter your Client Secret"
          className={cn(
            'w-full rounded border-[1.5px] border-slate-200 px-3 py-2 text-sm transition-colors',
            'placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
            errors.clientSecret && 'border-red-300 focus:border-red-400 focus:ring-red-100',
          )}
        />
        {errors.clientSecret && (
          <p className="mt-1 text-xs text-red-500">{errors.clientSecret.message}</p>
        )}
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          Refresh Token
        </label>
        <input
          {...register('refreshToken')}
          type="password"
          placeholder="Enter your Refresh Token"
          className={cn(
            'w-full rounded border-[1.5px] border-slate-200 px-3 py-2 text-sm transition-colors',
            'placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
            errors.refreshToken && 'border-red-300 focus:border-red-400 focus:ring-red-100',
          )}
        />
        {errors.refreshToken && (
          <p className="mt-1 text-xs text-red-500">
            {errors.refreshToken.message}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded bg-accent px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:-translate-y-px disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plug className="h-4 w-4" />
        )}
        Connect Gmail
      </button>
    </form>
  );
}

// ---------- Connect Modal Wrapper ----------

function ConnectModal({
  messenger,
  onClose,
}: {
  messenger: MessengerInfo;
  onClose: () => void;
}) {
  const connectMutation = useConnectIntegration();

  const handleConnect = (payload: Record<string, string>) => {
    connectMutation.mutate(
      { messenger: messenger.key, payload: payload as never },
      {
        onSuccess: () => {
          toast.success(`${messenger.name} connected successfully`);
          onClose();
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : 'Failed to connect',
          );
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        {/* Modal header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold',
                messenger.bgClass,
                messenger.textClass,
              )}
            >
              {messenger.abbr}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Connect {messenger.name}
              </h3>
              <p className="text-xs text-slate-500">{messenger.description}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Messenger-specific form */}
        {messenger.key === 'telegram' && (
          <TelegramConnectForm
            onSubmit={handleConnect}
            isPending={connectMutation.isPending}
          />
        )}
        {messenger.key === 'slack' && (
          <SlackConnectForm
            onSubmit={handleConnect}
            isPending={connectMutation.isPending}
          />
        )}
        {messenger.key === 'whatsapp' && (
          <WhatsAppConnectForm
            onSubmit={() => handleConnect({})}
            isPending={connectMutation.isPending}
          />
        )}
        {messenger.key === 'gmail' && (
          <GmailConnectForm
            onSubmit={handleConnect}
            isPending={connectMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Integration Card ----------

function IntegrationCard({
  info,
  integration,
  onConnect,
}: {
  info: MessengerInfo;
  integration?: Integration;
  onConnect: () => void;
}) {
  const disconnectMutation = useDisconnectIntegration();
  const reconnectMutation = useReconnectIntegration();

  const status: IntegrationStatus = integration?.status ?? 'disconnected';
  const config = statusConfig(status);
  const isConnected = status === 'connected';
  const needsAttention = status === 'token_expired' || status === 'session_expired';

  const handleDisconnect = () => {
    disconnectMutation.mutate(info.key, {
      onSuccess: () => toast.success(`${info.name} disconnected`),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to disconnect'),
    });
  };

  const handleReconnect = () => {
    reconnectMutation.mutate(info.key, {
      onSuccess: () => toast.success(`${info.name} reconnected successfully`),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to reconnect'),
    });
  };

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-xs">
      {/* Colored top stripe */}
      <div className={cn('h-1.5', info.bgClass)} />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-lg text-base font-bold',
                info.bgClass,
                info.textClass,
              )}
            >
              {info.abbr}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {info.name}
              </h3>
              <p className="text-xs text-slate-500">{info.description}</p>
            </div>
          </div>

          {/* Status badge */}
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
              config.badgeClass,
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', config.dotClass)} />
            {config.label}
          </span>
        </div>

        {/* Connected info */}
        {integration && status !== 'disconnected' && (
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-xs text-slate-500">
              Connected since{' '}
              <span className="font-medium text-slate-700">
                {formatDate(integration.connectedAt)}
              </span>
            </p>
          </div>
        )}

        {/* Warning for expired states */}
        {needsAttention && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-xs text-amber-700">
              {status === 'token_expired'
                ? 'Your access token has expired. Please reconnect to restore messaging.'
                : 'Your session has expired. Please reconnect to restore messaging.'}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-4 flex gap-2">
          {status === 'disconnected' ? (
            <button
              onClick={onConnect}
              className="flex flex-1 items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:-translate-y-px"
            >
              <Plug className="h-4 w-4" />
              Connect
            </button>
          ) : (
            <>
              <button
                onClick={handleReconnect}
                disabled={reconnectMutation.isPending}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded border-[1.5px] px-4 py-2 text-sm font-medium transition-all hover:-translate-y-px',
                  needsAttention
                    ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50',
                )}
              >
                {reconnectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reconnect
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
                className="flex items-center justify-center gap-2 rounded border-[1.5px] border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-all hover:-translate-y-px hover:bg-red-50"
              >
                {disconnectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Unplug className="h-4 w-4" />
                )}
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- FAQ Data ----------

interface FaqStep {
  text: string;
  link?: { url: string; label: string };
}

interface FaqItem {
  messenger: MessengerType;
  title: string;
  abbr: string;
  bgClass: string;
  textClass: string;
  steps: FaqStep[];
}

const faqItems: FaqItem[] = [
  {
    messenger: 'telegram',
    title: 'How to connect Telegram',
    abbr: 'TG',
    bgClass: 'bg-messenger-tg-bg',
    textClass: 'text-messenger-tg-text',
    steps: [
      {
        text: 'Go to my.telegram.org and log in with your phone number.',
        link: { url: 'https://my.telegram.org', label: 'my.telegram.org' },
      },
      { text: 'Select "API development tools".' },
      { text: 'Fill in the form: App title (any name) and Short name (any, e.g. "omnichannel").' },
      { text: 'Click "Create application". You will see your API ID (number) and API Hash (long string).' },
      { text: 'Copy the API ID and API Hash.' },
      { text: 'Go back to this page, click "Connect" on the Telegram card, and paste both values.' },
      { text: 'After connecting, you will be asked to enter your phone number and a verification code from Telegram to authorize the session.' },
    ],
  },
  {
    messenger: 'slack',
    title: 'How to connect Slack',
    abbr: 'SL',
    bgClass: 'bg-messenger-sl-bg',
    textClass: 'text-messenger-sl-text',
    steps: [
      {
        text: 'Go to api.slack.com/apps and click "Create New App".',
        link: { url: 'https://api.slack.com/apps', label: 'api.slack.com/apps' },
      },
      { text: 'Choose "From scratch", enter an App name and select your workspace.' },
      {
        text: 'In the left sidebar, go to "OAuth & Permissions".',
      },
      {
        text: 'Scroll down to "Bot Token Scopes" and add the following permissions: channels:history, channels:read, chat:write, groups:history, groups:read, im:history, im:read, im:write, mpim:history, mpim:read, users:read.',
      },
      { text: 'Scroll up and click "Install to Workspace", then click "Allow".' },
      { text: 'Copy the "Bot User OAuth Token" (starts with xoxb-).' },
      { text: 'Go back to this page, click "Connect" on the Slack card, and paste the Bot Token.' },
    ],
  },
  {
    messenger: 'whatsapp',
    title: 'How to connect WhatsApp',
    abbr: 'WA',
    bgClass: 'bg-messenger-wa-bg',
    textClass: 'text-messenger-wa-text',
    steps: [
      { text: 'Make sure WhatsApp is installed and active on your phone.' },
      { text: 'Click "Connect" on the WhatsApp card on this page.' },
      { text: 'A QR code will be displayed on screen.' },
      { text: 'Open WhatsApp on your phone, go to Settings (or Menu) > Linked Devices > Link a Device.' },
      { text: 'Point your phone camera at the QR code on this screen.' },
      { text: 'Wait for the connection to be established. It may take a few seconds.' },
      { text: 'Once linked, your WhatsApp chats will be available for import. The session stays active as long as your phone has internet access.' },
    ],
  },
  {
    messenger: 'gmail',
    title: 'How to connect Gmail',
    abbr: 'GM',
    bgClass: 'bg-messenger-gm-bg',
    textClass: 'text-messenger-gm-text',
    steps: [
      {
        text: 'Go to the Google Cloud Console and create a new project (or select an existing one).',
        link: { url: 'https://console.cloud.google.com/', label: 'console.cloud.google.com' },
      },
      { text: 'In the left menu, go to "APIs & Services" > "Library". Search for "Gmail API" and enable it.' },
      { text: 'Go to "APIs & Services" > "Credentials". Click "Create Credentials" > "OAuth client ID".' },
      { text: 'If prompted, configure the consent screen first: select "External", fill in the app name and your email.' },
      { text: 'For application type, select "Web application". Add http://localhost as an authorized redirect URI. Click "Create".' },
      { text: 'Copy the Client ID and Client Secret from the popup.' },
      {
        text: 'To get a Refresh Token, use the OAuth 2.0 Playground: go to developers.google.com/oauthplayground, click the gear icon, check "Use your own OAuth credentials", and paste your Client ID and Client Secret.',
        link: { url: 'https://developers.google.com/oauthplayground', label: 'OAuth Playground' },
      },
      { text: 'In the left panel, select "Gmail API v1" > select all scopes (or at least gmail.modify and gmail.send). Click "Authorize APIs" and sign in.' },
      { text: 'Click "Exchange authorization code for tokens". Copy the Refresh Token value.' },
      { text: 'Go back to this page, click "Connect" on the Gmail card, and paste all three values: Client ID, Client Secret, and Refresh Token.' },
    ],
  },
];

// ---------- FAQ Section Component ----------

function FaqSection() {
  const [openItem, setOpenItem] = useState<MessengerType | null>(null);

  return (
    <div className="mt-10 space-y-4">
      <div className="mb-2">
        <h2 className="text-base font-semibold text-slate-900">
          Frequently Asked Questions
        </h2>
        <p className="text-sm text-slate-500">
          Step-by-step guides for connecting each messenger.
        </p>
      </div>

      <div className="space-y-3">
        {faqItems.map((item) => {
          const isOpen = openItem === item.messenger;

          return (
            <div
              key={item.messenger}
              className="overflow-hidden rounded-lg bg-white shadow-xs transition-shadow hover:shadow-sm"
            >
              {/* Accordion header */}
              <button
                onClick={() => setOpenItem(isOpen ? null : item.messenger)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50"
              >
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
                    item.bgClass,
                    item.textClass,
                  )}
                >
                  {item.abbr}
                </div>
                <span className="flex-1 text-sm font-medium text-slate-800">
                  {item.title}
                </span>
                <svg
                  className={cn(
                    'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
                    isOpen && 'rotate-180',
                  )}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Accordion content */}
              {isOpen && (
                <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                  <ol className="space-y-3">
                    {item.steps.map((step, idx) => (
                      <li key={idx} className="flex gap-3">
                        <span
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                            item.bgClass,
                            item.textClass,
                          )}
                        >
                          {idx + 1}
                        </span>
                        <div className="pt-0.5 text-sm leading-relaxed text-slate-600">
                          {step.text}
                          {step.link && (
                            <>
                              {' '}
                              <a
                                href={step.link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-accent underline decoration-accent/30 underline-offset-2 transition-colors hover:text-accent-hover hover:decoration-accent"
                              >
                                {step.link.label}
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Main Component ----------

export function IntegrationsTab() {
  const { data, isLoading } = useIntegrations();
  const [connectingMessenger, setConnectingMessenger] =
    useState<MessengerInfo | null>(null);

  const integrationsByMessenger = (data?.integrations ?? []).reduce<
    Record<string, Integration>
  >((acc, int) => {
    acc[int.messenger] = int;
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="mb-2">
          <h2 className="text-base font-semibold text-slate-900">
            Connected Accounts
          </h2>
          <p className="text-sm text-slate-500">
            Manage your messenger integrations. Connect accounts to start
            sending and receiving messages.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {messengers.map((m) => (
            <IntegrationCard
              key={m.key}
              info={m}
              integration={integrationsByMessenger[m.key]}
              onConnect={() => setConnectingMessenger(m)}
            />
          ))}
        </div>
      </div>

      {/* FAQ Section */}
      <FaqSection />

      {/* Connect modal */}
      {connectingMessenger && (
        <ConnectModal
          messenger={connectingMessenger}
          onClose={() => setConnectingMessenger(null)}
        />
      )}
    </>
  );
}
