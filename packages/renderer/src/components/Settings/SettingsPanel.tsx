import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, SlidersHorizontal, Radio, Terminal, Package } from 'lucide-react';
import { AppSettings } from '@kleiber/shared';
import { GeneralSettings } from './GeneralSettings';
import { RemoteApiSettings } from './RemoteApiSettings';
import { CliSettings } from './CliSettings';
import { PackSettings } from './PackSettings';

type Section = 'general' | 'remote-api' | 'cli' | 'pack';

interface NavItem {
  id: Section;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', icon: <SlidersHorizontal size={15} /> },
  { id: 'remote-api', label: 'Remote API', icon: <Radio size={15} /> },
  { id: 'cli', label: 'Agent CLIs', icon: <Terminal size={15} /> },
  { id: 'pack', label: 'Pack & Updates', icon: <Package size={15} /> },
];

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ open, onOpenChange }) => {
  const [section, setSection] = useState<Section>('general');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setSaveError(null);
    window.kleiber.settings
      .get()
      .then((s) => {
        setSettings(s);
      })
      .catch((err: unknown) => {
        console.error('Failed to load settings', err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [open]);

  const handleUpdate = async (patch: Partial<AppSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setIsSaving(true);
    setSaveError(null);
    try {
      await window.kleiber.settings.update(patch);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
      // Revert optimistic update
      setSettings(settings);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetApp = async () => {
    if (!showResetConfirm) {
      setShowResetConfirm(true);
      return;
    }
    try {
      // Reset to defaults by sending empty/default values
      await window.kleiber.settings.update({
        remoteApiEnabled: false,
        remoteApiPort: null,
        remoteApiBindAddress: '0.0.0.0',
        theme: 'dark',
        quickLaunchShortcut: '',
      });
      setShowResetConfirm(false);
      onOpenChange(false);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to reset settings');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] max-w-[95vw] h-[520px] max-h-[90vh] bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg z-50 shadow-xl shadow-black/50 flex flex-col overflow-hidden"
          aria-describedby={undefined}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1C1C1C] shrink-0">
            <Dialog.Title className="text-base font-semibold text-[#FFFFFF]">Settings</Dialog.Title>
            <div className="flex items-center gap-3">
              {isSaving && <span className="text-xs text-[#666666]">Saving…</span>}
              {saveError && <span className="text-xs text-[#EF4444]">{saveError}</span>}
              <Dialog.Close className="text-[#666666] hover:text-[#FFFFFF] rounded-lg p-0.5 transition-colors">
                <X size={18} />
              </Dialog.Close>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar nav */}
            <nav className="w-44 shrink-0 border-r border-[#1C1C1C] py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                    section === item.id
                      ? 'bg-[#141414] text-[#FFFFFF]'
                      : 'text-[#666666] hover:text-[#FFFFFF] hover:bg-[#0A0A0A]'
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {isLoading || !settings ? (
                <div className="flex items-center justify-center h-full text-[#666666] text-sm">
                  Loading…
                </div>
              ) : (
                <>
                  {section === 'general' && (
                    <GeneralSettings settings={settings} onUpdate={handleUpdate} />
                  )}
                  {section === 'remote-api' && (
                    <RemoteApiSettings settings={settings} onUpdate={handleUpdate} />
                  )}
                  {section === 'cli' && <CliSettings />}
                  {section === 'pack' && (
                    <PackSettings
                      onRequestResetApp={() => void handleResetApp()}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {/* Reset confirmation footer */}
          {showResetConfirm && (
            <div className="shrink-0 border-t border-[#EF4444]/30 bg-[#EF4444]/5 px-5 py-3 flex items-center justify-between gap-4">
              <p className="text-sm text-[#EF4444]">
                Are you sure? All settings will be reset to defaults. This cannot be undone.
              </p>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 text-sm text-[#666666] hover:text-[#FFFFFF] hover:bg-[#141414] rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleResetApp()}
                  className="px-3 py-1.5 text-sm font-medium bg-[#EF4444] text-[#FFFFFF] hover:bg-[#DC2626] rounded-lg transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
