import React, { useEffect, useState } from 'react';

interface PackStatus {
  installed: boolean;
  globallyInstalled?: boolean;
  globalDetectionPath?: string;
  projectConfigError?: string | null;
}

export const AgentPackBanner: React.FC = () => {
  const [status, setStatus] = useState<PackStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setIsLoading(true);
    try {
      const nextStatus = await window.kleiber.pack.status();
      setStatus(nextStatus);
      setError(null);
    } catch (loadError) {
      console.error('Failed to load agent pack status', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load agent pack status');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleInstall = async () => {
    setIsInstalling(true);
    setError(null);

    try {
      await window.kleiber.pack.install();
      await loadStatus();
    } catch (installError) {
      console.error('Failed to install agent pack globally', installError);
      setError(installError instanceof Error ? installError.message : 'Failed to install agent pack globally');
    } finally {
      setIsInstalling(false);
    }
  };

  if (isLoading || status?.installed) {
    return null;
  }

  return (
    <div className="border-b border-[#854D0E] bg-[#1C1917] px-4 py-3 text-[#FED7AA]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#FDBA74]">coding-agent-pack is not installed globally</p>
          <p className="mt-1 text-xs text-[#FED7AA]/80">
            Global roles and orchestration helpers stay limited until the pack is installed system-wide.
          </p>
          {status?.globalDetectionPath && (
            <p className="mt-1 truncate font-mono text-[11px] text-[#FED7AA]/60">{status.globalDetectionPath}</p>
          )}
          {status?.projectConfigError && (
            <p className="mt-2 text-xs text-[#FCA5A5]">Project config warning: {status.projectConfigError}</p>
          )}
          {error && <p className="mt-2 text-xs text-[#FCA5A5]">{error}</p>}
        </div>

        <button
          type="button"
          onClick={() => void handleInstall()}
          disabled={isInstalling}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[#F97316] px-4 text-sm font-medium text-[#09090B] transition hover:bg-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isInstalling ? 'Installing…' : 'Install globally'}
        </button>
      </div>
    </div>
  );
};
