'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Settings, Building2, User } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { IntegrationsTab } from '@/components/settings/IntegrationsTab';
import { WorkspaceTab } from '@/components/settings/WorkspaceTab';
import { ProfileTab } from '@/components/settings/ProfileTab';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth';

type Tab = 'integrations' | 'workspace' | 'profile';

const ALL_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'integrations', label: 'Integrations', icon: Settings },
  { id: 'workspace', label: 'Workspace', icon: Building2 },
  { id: 'profile', label: 'Profile', icon: User },
];

const oauthErrorMessages: Record<string, string> = {
  oauth_not_configured: 'OAuth is not configured on the server. Please use manual credential input.',
  no_organization: 'No organization selected. Please select an organization in the sidebar first.',
  missing_params: 'OAuth callback received incomplete data. Please try again.',
  invalid_or_expired_state: 'OAuth session expired. Please try connecting again.',
  corrupted_state: 'OAuth session was corrupted. Please try connecting again.',
  token_exchange_failed: 'Failed to exchange authorization code. Please try again.',
  token_verification_failed: 'Token could not be verified. Please try again.',
  access_denied: 'You denied the authorization request.',
  no_refresh_token: 'Google did not return a refresh token. Please revoke app access at myaccount.google.com/permissions and try again.',
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('integrations');
  const [autoOpenMessenger, setAutoOpenMessenger] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // Hide Workspace tab for regular users
  const tabs = user?.role === 'user'
    ? ALL_TABS.filter((t) => t.id !== 'workspace')
    : ALL_TABS;

  // Handle OAuth callback query parameters
  useEffect(() => {
    const integration = searchParams.get('integration');
    const status = searchParams.get('status');
    const error = searchParams.get('error');

    if (!integration || !status) return;

    if (status === 'connected') {
      toast.success(`${integration.charAt(0).toUpperCase() + integration.slice(1)} connected successfully via OAuth`);
      // Await fresh data before opening wizard — prevents race condition
      // where wizard sees stale "disconnected" status
      (async () => {
        await queryClient.invalidateQueries({ queryKey: ['integrations'] });
        setAutoOpenMessenger(integration as 'telegram' | 'slack' | 'whatsapp' | 'gmail');
      })();
    } else if (status === 'error' && error) {
      const friendlyMessage = oauthErrorMessages[error] ?? `OAuth error: ${error}`;
      toast.error(friendlyMessage);
    }

    // Clean up URL query params after handling
    router.replace('/settings', { scroll: false });
  }, [searchParams, router, queryClient]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your integrations, workspace, and profile
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-8 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex flex-1 flex-shrink-0 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-all',
                activeTab === id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'integrations' && (
          <IntegrationsTab
            autoOpenMessenger={autoOpenMessenger}
            onAutoOpenHandled={() => setAutoOpenMessenger(null)}
          />
        )}
        {activeTab === 'workspace' && <WorkspaceTab />}
        {activeTab === 'profile' && <ProfileTab />}
      </div>
    </div>
  );
}
