import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Session, UUID, SessionType, AgentCli } from '@kleiber/shared';
import { X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

const CLIS: { value: string; label: string }[] = [
  { value: 'plain', label: 'Plain Terminal' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'gemini-cli', label: 'Gemini CLI' },
];

const ROLES: { value: string; label: string }[] = [
  { value: 'plain', label: 'Plain Terminal' },
  { value: 'requirements-engineer', label: 'Requirements Engineer' },
  { value: 'requirements-refiner', label: 'Requirements Refiner' },
  { value: 'architect', label: 'Architect' },
  { value: 'security-analyst', label: 'Security Analyst' },
  { value: 'security-reviewer', label: 'Security Reviewer' },
  { value: 'task-planner', label: 'Task Planner' },
  { value: 'project-manager', label: 'Project Manager' },
  { value: 'brainstormer', label: 'Brainstormer' },
  { value: 'specification-reviewer', label: 'Specification Reviewer' },
  { value: 'documentation-writer', label: 'Documentation Writer' },
  { value: 'ui-ux-designer', label: 'UI/UX Designer' },
  { value: 'test-engineer', label: 'Test Engineer' },
  { value: 'field-tester', label: 'Field Tester' },
];

export interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: UUID;
  parentSessionId?: UUID;
  projectYoloDefault: boolean;
  onCreated?: (session: Session) => void;
}

export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  parentSessionId,
  projectYoloDefault,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [cli, setCli] = useState<string>('plain');
  const [role, setRole] = useState<string>('plain');
  const [yolo, setYolo] = useState(projectYoloDefault);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addSession = useAppStore((state) => state.addSession);

  const isPlain = cli === 'plain' && role === 'plain';
  const yoloDisabled = !projectYoloDefault || isPlain;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const type: SessionType =
        role !== 'plain' ? 'agent_role' : cli !== 'plain' ? 'agent' : 'plain';

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
        name,
        type,
        yolo: type !== 'plain' ? yolo : false,
      };

      if (parentSessionId) payload.parentSessionId = parentSessionId;
      if (cli !== 'plain') payload.cli = cli as AgentCli;
      if (role !== 'plain') payload.role = role;

      const session = await window.kleiber.sessions.create(payload);
      addSession(session);
      onCreated?.(session);
      onOpenChange(false);
      setName('');
      setCli('plain');
      setRole('plain');
      setYolo(projectYoloDefault);
    } catch (err: any) {
      console.error('Failed to create session', err);
      setError(err.message || 'Failed to create session');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[#09090B]/80 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#18181B] border border-[#3F3F46] rounded-lg z-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-medium text-[#FAFAFA]">
              New Session
            </Dialog.Title>
            <Dialog.Close className="text-[#A1A1AA] hover:text-[#FAFAFA] rounded-sm opacity-70 hover:opacity-100 transition-opacity">
              <X size={20} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && <div className="text-red-500 text-sm bg-red-500/10 p-2 rounded">{error}</div>}
            <div className="flex flex-col gap-2">
              <label htmlFor="session-name" className="text-sm font-medium text-[#FAFAFA]">
                Name
              </label>
              <input
                id="session-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex h-10 w-full rounded-md border border-[#3F3F46] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#FAFAFA]"
                placeholder="Session Name"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="cli-select" className="text-sm font-medium text-[#FAFAFA]">
                CLI Tool
              </label>
              <select
                id="cli-select"
                value={cli}
                onChange={(e) => setCli(e.target.value)}
                className="flex h-10 w-full rounded-md border border-[#3F3F46] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#FAFAFA]"
              >
                {CLIS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="role-select" className="text-sm font-medium text-[#FAFAFA]">
                Agent Role
              </label>
              <select
                id="role-select"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="flex h-10 w-full rounded-md border border-[#3F3F46] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#FAFAFA]"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                id="session-yolo"
                checked={yolo}
                onChange={(e) => setYolo(e.target.checked)}
                disabled={yoloDisabled}
                className="h-4 w-4 rounded border-[#3F3F46] bg-[#09090B] disabled:opacity-50"
              />
              <label
                htmlFor="session-yolo"
                className={`text-sm font-medium ${yoloDisabled ? 'text-[#A1A1AA]' : 'text-[#FAFAFA]'}`}
              >
                Enable YOLO mode
              </label>
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-medium text-[#FAFAFA] hover:bg-[#27272A] rounded-md transition-colors"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={isSubmitting || !name}
                className="px-4 py-2 text-sm font-medium bg-[#FAFAFA] text-[#09090B] hover:bg-[#FAFAFA]/90 rounded-md transition-colors disabled:opacity-50"
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
