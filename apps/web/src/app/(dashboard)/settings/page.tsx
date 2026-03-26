'use client';

import { useState } from 'react';
import { Settings, Building2, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IntegrationsTab } from '@/components/settings/IntegrationsTab';
import { WorkspaceTab } from '@/components/settings/WorkspaceTab';
import { ProfileTab } from '@/components/settings/ProfileTab';

type Tab = 'integrations' | 'workspace' | 'profile';

const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'integrations', label: 'Integrations', icon: Settings },
  { id: 'workspace', label: 'Workspace', icon: Building2 },
  { id: 'profile', label: 'Profile', icon: User },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('integrations');

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your integrations, workspace, and profile
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-8 flex gap-1 rounded-lg bg-slate-100 p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-all',
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
        {activeTab === 'integrations' && <IntegrationsTab />}
        {activeTab === 'workspace' && <WorkspaceTab />}
        {activeTab === 'profile' && <ProfileTab />}
      </div>
    </div>
  );
}
