import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AppSettings } from '@kleiber/shared';

interface RemoteApiSettingsProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export const RemoteApiSettings: React.FC<RemoteApiSettingsProps> = ({ settings, onUpdate }) => {
  const [showToken, setShowToken] = useState(false);
  const [portInput, setPortInput] = useState<string>(
    settings.remoteApiPort != null ? String(settings.remoteApiPort) : '',
  );
  const [portError, setPortError] = useState<string | null>(null);

  const handlePortChange = (value: string) => {
    setPortInput(value);
    if (value === '') {
      setPortError(null);
      onUpdate({ remoteApiPort: null });
      return;
    }
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1024 || num > 65535) {
      setPortError('Port must be a number between 1024 and 65535.');
    } else {
      setPortError(null);
      onUpdate({ remoteApiPort: num });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[#FFFFFF] mb-1">Remote API</h2>
        <p className="text-sm text-[#666666]">
          Expose a local HTTP/WebSocket API so external agents can control sessions.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-[#FFFFFF]">Enable Remote API</p>
            <p className="text-xs text-[#666666] mt-0.5">
              Start the API server when the app launches.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.remoteApiEnabled}
            onClick={() => onUpdate({ remoteApiEnabled: !settings.remoteApiEnabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              settings.remoteApiEnabled ? 'bg-[#FFFFFF]' : 'bg-[#1C1C1C]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                settings.remoteApiEnabled
                  ? 'translate-x-6 bg-[#000000]'
                  : 'translate-x-1 bg-[#666666]'
              }`}
            />
          </button>
        </div>

        {/* Port */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-[#FFFFFF]">Port</label>
          <input
            type="number"
            min={1024}
            max={65535}
            value={portInput}
            onChange={(e) => handlePortChange(e.target.value)}
            disabled={!settings.remoteApiEnabled}
            placeholder="9100"
            className="flex h-9 w-full max-w-xs rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] placeholder:text-[#444444] focus:outline-none focus:border-[#333333] transition-colors disabled:opacity-40"
          />
          {portError && <p className="text-xs text-[#EF4444]">{portError}</p>}
          <p className="text-xs text-[#666666]">
            Leave blank to auto-assign starting from 9100.
          </p>
        </div>

        {/* Bind address */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-[#FFFFFF]">Bind Address</label>
          <input
            type="text"
            value={settings.remoteApiBindAddress}
            onChange={(e) => onUpdate({ remoteApiBindAddress: e.target.value })}
            disabled={!settings.remoteApiEnabled}
            placeholder="0.0.0.0"
            className="flex h-9 w-full max-w-xs rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] placeholder:text-[#444444] focus:outline-none focus:border-[#333333] transition-colors disabled:opacity-40"
          />
          <p className="text-xs text-[#666666]">
            Use <code className="font-mono text-[#888888]">127.0.0.1</code> to restrict to localhost only.
          </p>
        </div>

        {/* Credentials display */}
        <div className="flex flex-col gap-2 border border-[#1C1C1C] rounded-lg p-4 bg-[#0A0A0A]">
          <p className="text-[13px] font-medium text-[#FFFFFF]">API Credentials</p>
          <p className="text-xs text-[#666666]">
            Credentials are auto-generated and stored securely. Use these to authenticate external clients.
          </p>

          <div className="flex flex-col gap-3 mt-2">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">Username</span>
              <div className="flex items-center gap-2 h-8 px-3 rounded-lg bg-[#000000] border border-[#1C1C1C]">
                <span className="text-sm font-mono text-[#AAAAAA]">kleiber</span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">Token / Password</span>
              <div className="flex items-center gap-2 h-8 px-3 rounded-lg bg-[#000000] border border-[#1C1C1C]">
                <span className="flex-1 text-sm font-mono text-[#AAAAAA] truncate">
                  {showToken ? '(stored securely — not readable from UI)' : '••••••••••••••••'}
                </span>
                <button
                  onClick={() => setShowToken((v) => !v)}
                  className="text-[#666666] hover:text-[#FFFFFF] transition-colors"
                  aria-label={showToken ? 'Hide token' : 'Show token'}
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-xs text-[#666666]">
                The token is encrypted via OS keychain and cannot be shown in plaintext here.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
