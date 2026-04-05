import React, { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { BUNDLED_PACK_DISPLAY_NAME } from '@kleiber/shared';

interface PackStatus {
  installed: boolean;
  globallyInstalled?: boolean;
  globalDetectionPath?: string;
  projectConfigError?: string | null;
}

interface PackSettingsProps {
  onRequestResetApp: () => void;
}

export const PackSettings: React.FC<PackSettingsProps> = ({ onRequestResetApp }) => {
  const [status, setStatus] = useState<PackStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installSuccess, setInstallSuccess] = useState(false);

  const loadStatus = async () => {
    setIsLoading(true);
    try {
      const s = await window.kleiber.pack.status();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pack status');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleReinstall = async () => {
    setIsInstalling(true);
    setError(null);
    setInstallSuccess(false);
    try {
      await window.kleiber.pack.install();
      await loadStatus();
      setInstallSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[#FFFFFF] mb-1">Pack &amp; Updates</h2>
        <p className="text-sm text-[#666666]">
          Manage {BUNDLED_PACK_DISPLAY_NAME}, which provides roles, harness adapters, and orchestration.
        </p>
      </div>

      {/* Pack status card */}
      <div className="flex flex-col gap-3 border border-[#1C1C1C] rounded-lg p-4 bg-[#0A0A0A]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[#FFFFFF]">{BUNDLED_PACK_DISPLAY_NAME}</p>
            {isLoading ? (
              <p className="text-xs text-[#666666] mt-0.5">Checking status…</p>
            ) : status?.globallyInstalled ? (
              <p className="text-xs text-[#22C55E] mt-0.5">Installed globally</p>
            ) : (
              <p className="text-xs text-[#EF4444] mt-0.5">Not installed globally</p>
            )}
            {status?.globalDetectionPath && (
              <p className="mt-1 font-mono text-[11px] text-[#666666] truncate max-w-xs">
                {status.globalDetectionPath}
              </p>
            )}
          </div>

          <button
            onClick={() => void handleReinstall()}
            disabled={isInstalling || isLoading}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#FFFFFF] text-[#000000] text-sm font-medium transition-colors hover:bg-[#E5E5E5] disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ml-4"
          >
            <RefreshCw size={13} className={isInstalling ? 'animate-spin' : ''} />
            {isInstalling ? 'Installing…' : 'Reinstall'}
          </button>
        </div>

        {installSuccess && (
          <p className="text-xs text-[#22C55E]">{BUNDLED_PACK_DISPLAY_NAME} installed successfully.</p>
        )}
        {error && <p className="text-xs text-[#EF4444]">{error}</p>}
        {status?.projectConfigError && (
          <p className="text-xs text-[#F59E0B]">
            Project config warning: {status.projectConfigError}
          </p>
        )}
      </div>

      {/* Danger Zone */}
      <div className="flex flex-col gap-3 border border-[#EF4444]/30 rounded-lg p-4 bg-[#EF4444]/5">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={15} className="text-[#EF4444]" />
          <p className="text-[13px] font-semibold text-[#EF4444]">Danger Zone</p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium text-[#FFFFFF]">Reset All Settings</p>
            <p className="text-xs text-[#666666] mt-0.5">
              Clears all app settings and stored credentials. This cannot be undone.
            </p>
          </div>
          <button
            onClick={onRequestResetApp}
            className="inline-flex items-center h-8 px-3 rounded-lg border border-[#EF4444]/50 text-[#EF4444] text-sm font-medium transition-colors hover:bg-[#EF4444]/10 shrink-0 mt-0.5"
          >
            Reset App
          </button>
        </div>
      </div>
    </div>
  );
};
