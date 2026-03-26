'use client';

import { useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const timezones = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
];

const languages = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ru', label: 'Russian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
];

export function WorkspaceTab() {
  const [orgName, setOrgName] = useState('My Organization');
  const [timezone, setTimezone] = useState('UTC');
  const [language, setLanguage] = useState('en');
  const [chatVisibility, setChatVisibility] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    // Placeholder: would call PATCH /api/organizations/:id
    await new Promise((resolve) => setTimeout(resolve, 600));
    setIsSaving(false);
    toast.success('Workspace settings saved');
  };

  const inputClass = cn(
    'w-full rounded border-[1.5px] border-slate-200 px-3 py-2 text-sm transition-colors',
    'placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15',
  );

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h2 className="text-base font-semibold text-slate-900">
          Workspace Settings
        </h2>
        <p className="text-sm text-slate-500">
          Configure your organization preferences
        </p>
      </div>

      <div className="rounded-lg bg-white p-6 shadow-xs">
        <div className="space-y-5">
          {/* Organization Name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Organization Name
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Enter organization name"
              className={inputClass}
            />
          </div>

          {/* Timezone */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={inputClass}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Language */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Language
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={inputClass}
            >
              {languages.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* Chat Visibility Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-slate-100 p-4">
            <div>
              <p className="text-sm font-medium text-slate-700">
                Chat Visibility
              </p>
              <p className="text-xs text-slate-500">
                Allow all workspace members to see all imported chats
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={chatVisibility}
              onClick={() => setChatVisibility(!chatVisibility)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors',
                chatVisibility ? 'bg-accent' : 'bg-slate-200',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow-sm transition-transform',
                  chatVisibility ? 'translate-x-[22px]' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </div>

        {/* Save */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded bg-accent px-5 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:-translate-y-px disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
