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
