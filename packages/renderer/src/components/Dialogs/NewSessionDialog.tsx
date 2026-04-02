import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Session, UUID, SessionType, AgentCli } from '@kleiber/shared';
import { X } from 'lucide-react';

const CLIS: Array<{ value: AgentCli | 'plain'; label: string }> = [
  { value: 'plain', label: 'Plain Terminal' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'gemini', label: 'Gemini CLI' },
];
const AGENT_CLIS: AgentCli[] = ['claude', 'codex', 'opencode', 'gemini'];

function formatRoleLabel(role: string): string {
  return role
    .split('-')
    .map((segment) => {
      if (segment.toLowerCase() === 'ux') {
        return 'UI/UX';
      }
      return `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`;
    })
    .join(' ');
}

export interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: UUID;
  parentSessionId?: UUID;
  onCreated?: (session: Session) => void;
}

export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  parentSessionId,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [cli, setCli] = useState<AgentCli | 'plain'>('plain');
  const [role, setRole] = useState<string>('plain');
  const [roles, setRoles] = useState<string[]>([]);
  const [packInstalled, setPackInstalled] = useState(true);
  const [detectedClis, setDetectedClis] = useState<AgentCli[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [isLoadingClis, setIsLoadingClis] = useState(false);
  const [yolo, setYolo] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPlain = cli === 'plain' && role === 'plain';
  const yoloDisabled = isPlain;

  const roleOptions = useMemo(
    () => [
      { value: 'plain', label: 'No Agent' },
      ...roles.map((roleName) => ({ value: roleName, label: formatRoleLabel(roleName) })),
    ],
    [roles],
  );
  const cliOptions = useMemo(
    () => CLIS.filter((entry) => entry.value === 'plain' || detectedClis.includes(entry.value)),
    [detectedClis],
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setYolo(false);
    setIsLoadingRoles(true);
    setIsLoadingClis(true);

    Promise.all([
      window.kleiber.pack.roles(),
      window.kleiber.pack.status(projectId),
      Promise.all(
        AGENT_CLIS.map(async (cliName) => ({
          cli: cliName,
          detected: await window.kleiber.pack.detectCli(cliName).catch(() => false),
        })),
      ),
    ])
      .then(([availableRoles, status, cliDetections]) => {
        if (cancelled) return;
        setPackInstalled(status.installed);
        setRoles(availableRoles);
        setDetectedClis(
          cliDetections
            .filter((entry) => entry.detected)
            .map((entry) => entry.cli),
        );
      })
      .catch((loadError) => {
        if (cancelled) return;
        setPackInstalled(false);
        setRoles([]);
        setDetectedClis([]);
        console.error('Failed to load pack roles', loadError);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingRoles(false);
          setIsLoadingClis(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (role !== 'plain' && !roles.includes(role)) {
      setRole('plain');
    }
  }, [role, roles]);

  useEffect(() => {
    if (cli !== 'plain' && !detectedClis.includes(cli)) {
      setCli('plain');
      setRole('plain');
      setYolo(false);
    }
  }, [cli, detectedClis]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    if (role !== 'plain' && cli === 'plain') {
      setError('Choose a harness when selecting an agent.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const type: SessionType = role !== 'plain' ? 'agent_role' : cli !== 'plain' ? 'agent' : 'plain';
      const payload: {
        projectId: UUID;
        name: string;
        type: SessionType;
        cli?: AgentCli;
        role?: string;
        yolo?: boolean;
        parentSessionId?: UUID;
      } = {
        projectId,
        name: name.trim(),
        type,
        yolo: type !== 'plain' ? yolo : false,
      };

      if (parentSessionId) payload.parentSessionId = parentSessionId;
      if (cli !== 'plain') payload.cli = cli;
      if (role !== 'plain') payload.role = role;

      const session = await window.kleiber.sessions.create(payload);
      onCreated?.(session);
      onOpenChange(false);
      setName('');
      setCli('plain');
      setRole('plain');
      setYolo(false);
    } catch (submitError: unknown) {
      console.error('Failed to create session', submitError);
      setError(submitError instanceof Error ? submitError.message : 'Failed to create session');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg z-50 p-6 shadow-xl shadow-black/50">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-base font-semibold text-[#FFFFFF]">
              {parentSessionId ? 'New Sub-Session' : 'New Session'}
            </Dialog.Title>
            <Dialog.Close className="text-[#666666] hover:text-[#FFFFFF] rounded-lg p-0.5 transition-colors">
              <X size={18} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && <div className="text-[#EF4444] text-sm bg-[#EF4444]/10 p-2.5 rounded-lg">{error}</div>}

            {!packInstalled && (
              <div className="text-[#666666] text-xs bg-[#141414] border border-[#1C1C1C] p-2.5 rounded-lg">
                Agent pack is not installed globally. Predefined agent options may be unavailable.
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="session-name" className="text-[13px] font-medium text-[#FFFFFF]">
                Name
              </label>
              <input
                id="session-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="flex h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] placeholder:text-[#444444] focus:outline-none focus:border-[#333333] transition-colors"
                placeholder={parentSessionId ? 'Sub-session Name' : 'Session Name'}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cli-select" className="text-[13px] font-medium text-[#FFFFFF]">
                Harness
              </label>
              <select
                id="cli-select"
                value={cli}
                onChange={(event) => setCli(event.target.value as AgentCli | 'plain')}
                className="flex h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#333333] transition-colors"
              >
                {cliOptions.map((cliOption) => (
                  <option key={cliOption.value} value={cliOption.value}>
                    {cliOption.label}
                  </option>
                ))}
              </select>
              {!isLoadingClis && cliOptions.length === 1 && (
                <span className="text-xs text-[#666666]">
                  No installed agent harnesses were detected on PATH.
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="role-select" className="text-[13px] font-medium text-[#FFFFFF]">
                Agent
              </label>
              <select
                id="role-select"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className="flex h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#333333] transition-colors"
                disabled={isLoadingRoles}
              >
                {roleOptions.map((roleOption) => (
                  <option key={roleOption.value} value={roleOption.value}>
                    {roleOption.label}
                  </option>
                ))}
              </select>
              {isLoadingRoles && <span className="text-xs text-[#666666]">Loading roles...</span>}
            </div>

            <div className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                id="session-yolo"
                checked={yolo}
                onChange={(event) => setYolo(event.target.checked)}
                disabled={yoloDisabled}
                aria-disabled={yoloDisabled}
                className="h-4 w-4 rounded border-[#1C1C1C] bg-[#000000] accent-white disabled:opacity-40"
              />
              <label
                htmlFor="session-yolo"
                className={`text-[13px] font-medium ${yoloDisabled ? 'text-[#666666]' : 'text-[#FFFFFF]'}`}
              >
                Enable YOLO mode
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-[#1C1C1C]">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-medium text-[#666666] hover:text-[#FFFFFF] hover:bg-[#141414] rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={isSubmitting || !name.trim()}
                className="px-4 py-2 text-sm font-medium bg-[#FFFFFF] text-[#000000] hover:bg-[#E5E5E5] rounded-lg transition-colors disabled:opacity-40"
              >
                {isSubmitting ? 'Creating...' : 'Create Session'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
