import React, { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AppSettings, RemoteApiCredentialsSummary } from '@kleiber/shared';

interface RemoteApiSettingsProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export const RemoteApiSettings: React.FC<RemoteApiSettingsProps> = ({ settings, onUpdate }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [portInput, setPortInput] = useState<string>(
    settings.remoteApiPort != null ? String(settings.remoteApiPort) : '',
  );
  const [portError, setPortError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<RemoteApiCredentialsSummary | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [credentialsNotice, setCredentialsNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setCredentialsLoading(true);
    window.kleiber.remoteApiCredentials
      .get()
      .then((nextCredentials) => {
        if (cancelled) {
          return;
        }

        setCredentials(nextCredentials);
        setUsernameInput(nextCredentials.username);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        setCredentialsError(
          err instanceof Error ? err.message : 'Failed to load remote API credentials',
        );
      })
      .finally(() => {
        if (!cancelled) {
          setCredentialsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleSaveCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setCredentialsSaving(true);
    setCredentialsError(null);
    setCredentialsNotice(null);

    try {
      const nextCredentials = await window.kleiber.remoteApiCredentials.update({
        username: usernameInput.trim(),
        password: passwordInput,
      });
      setCredentials(nextCredentials);
      setUsernameInput(nextCredentials.username);
      setPasswordInput('');
      setCredentialsNotice(
        passwordInput
          ? 'Credentials updated and stored securely.'
          : 'Username updated. Existing password was kept.',
      );
    } catch (err: unknown) {
      setCredentialsError(
        err instanceof Error ? err.message : 'Failed to update remote API credentials',
      );
    } finally {
      setCredentialsSaving(false);
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

        <form
          onSubmit={handleSaveCredentials}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-[#FFFFFF]">API Credentials</p>
            {credentialsLoading ? (
              <p className="text-xs text-[#666666]">Loading credentials…</p>
            ) : (
              <p className="text-xs text-[#666666]">
                Credentials are stored securely via the OS keychain. Leave password blank to keep
                the current one.
              </p>
            )}
          </div>

          {settings.remoteApiEnabled && !credentials?.hasPassword && !credentialsLoading && (
            <p className="text-xs text-[#F59E0B]">
              Save a username and password before trying to connect from the remote web UI.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="remote-api-username"
              className="text-[11px] font-medium text-[#666666] uppercase tracking-wider"
            >
              Username
            </label>
            <input
              id="remote-api-username"
              type="text"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              disabled={credentialsLoading || credentialsSaving}
              placeholder="kleiber"
              className="flex h-9 w-full max-w-xs rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] placeholder:text-[#444444] focus:outline-none focus:border-[#333333] transition-colors disabled:opacity-40"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="remote-api-password"
              className="text-[11px] font-medium text-[#666666] uppercase tracking-wider"
            >
              Password
            </label>
            <div className="relative flex w-full max-w-xs items-center">
              <input
                id="remote-api-password"
                type={showPassword ? 'text' : 'password'}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                disabled={credentialsLoading || credentialsSaving}
                placeholder={credentials?.hasPassword ? 'Leave blank to keep current password' : 'Set a password'}
                className="flex h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 pr-10 text-sm text-[#FFFFFF] placeholder:text-[#444444] focus:outline-none focus:border-[#333333] transition-colors disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 text-[#666666] hover:text-[#FFFFFF] transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                disabled={credentialsLoading || credentialsSaving}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-[#666666]">
              {credentials?.hasPassword
                ? 'Your current password is not readable from the UI.'
                : 'A password is required for remote API authentication.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={credentialsLoading || credentialsSaving}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[#FFFFFF] px-4 text-sm font-medium text-[#000000] transition-colors hover:bg-[#E5E5E5] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {credentialsSaving ? 'Saving…' : 'Save Credentials'}
            </button>

            {credentialsError && <p className="text-xs text-[#EF4444]">{credentialsError}</p>}
            {!credentialsError && credentialsNotice && (
              <p className="text-xs text-[#22C55E]">{credentialsNotice}</p>
            )}
          </div>

          <p className="text-xs text-[#666666]">
            Remote API traffic is HTTP by default. Use a reverse proxy if you need TLS on untrusted
            networks.
          </p>
        </form>
      </div>
    </div>
  );
};
