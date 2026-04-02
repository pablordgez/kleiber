import React, { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { AgentCli, RemoteApiSessionOptions, SessionRecord, SessionType } from "@kleiber/shared";
import { ApiClient } from "../api/api";

const HARNESS_LABELS: Record<AgentCli, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
};

function formatAgentLabel(agent: string): string {
  return agent
    .split("-")
    .map((segment) => {
      if (segment.toLowerCase() === "ux") {
        return "UI/UX";
      }
      return `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`;
    })
    .join(" ");
}

interface NewSessionDialogProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (session: SessionRecord) => void;
}

export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  projectId,
  isOpen,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState("");
  const [type, setType] = useState<SessionType>("plain");
  const [cli, setCli] = useState<AgentCli>("codex");
  const [role, setRole] = useState("plain");
  const [yolo, setYolo] = useState(false);
  const [sessionOptions, setSessionOptions] = useState<RemoteApiSessionOptions>({
    availableHarnesses: [],
    availableAgents: [],
  });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const resetForm = () => {
    setName("");
    setType("plain");
    setRole("plain");
    setYolo(false);
    setError("");
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    setOptionsLoading(true);
    ApiClient.getSessionOptions(projectId)
      .then((options) => {
        if (cancelled) {
          return;
        }
        setSessionOptions(options);
        setCli((current) => options.availableHarnesses.includes(current) ? current : (options.availableHarnesses[0] ?? "codex"));
      })
      .catch((err: any) => {
        if (cancelled) {
          return;
        }
        setError(err.message || "Failed to load session options");
      })
      .finally(() => {
        if (!cancelled) {
          setOptionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId]);

  useEffect(() => {
    if (role !== "plain" && !sessionOptions.availableAgents.includes(role)) {
      setRole("plain");
    }
  }, [role, sessionOptions.availableAgents]);

  const harnessOptions = useMemo(
    () =>
      sessionOptions.availableHarnesses.map((harness) => ({
        value: harness,
        label: HARNESS_LABELS[harness],
      })),
    [sessionOptions.availableHarnesses],
  );

  const agentOptions = useMemo(
    () => [
      { value: "plain", label: "No Agent" },
      ...sessionOptions.availableAgents.map((agent) => ({
        value: agent,
        label: formatAgentLabel(agent),
      })),
    ],
    [sessionOptions.availableAgents],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (type === "agent_role" && role === "plain") {
      setError("Choose an agent for harness + agent sessions");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const payload: {
        name: string;
        type: SessionType;
        cli?: AgentCli;
        role?: string;
        yolo?: boolean;
      } = {
        name: name.trim(),
        type,
      };
      if (type !== "plain") {
        payload.cli = cli;
        payload.yolo = yolo;
      }
      if (type === "agent_role") {
        payload.role = role;
      }

      const session = await ApiClient.createSession(projectId, payload);
      resetForm();
      onCreated(session);
    } catch (err: any) {
      setError(err.message || "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  const yoloDisabled = type === "plain";

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetForm();
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#0A0A0A] border border-[#1C1C1C] rounded-xl p-6 shadow-2xl z-50 text-[#FFFFFF]">
          <Dialog.Title className="text-lg font-semibold tracking-tight mb-4">New Session</Dialog.Title>
          
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && <div className="text-sm text-[#EF4444]">{error}</div>}
            
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-[#666666]">Session Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] focus:border-[#333333] focus:outline-none transition-colors"
                placeholder="e.g. Build API..."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-[#666666]">Session Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as SessionType)}
                className="h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] focus:border-[#333333] focus:outline-none transition-colors"
              >
                <option value="plain">Terminal</option>
                <option value="agent">Harness</option>
                <option value="agent_role">Harness + Agent</option>
              </select>
            </div>

            {type !== "plain" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-[#666666]">Harness</label>
                <select
                  value={cli}
                  onChange={(e) => setCli(e.target.value as AgentCli)}
                  disabled={optionsLoading || harnessOptions.length === 0}
                  className="h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] focus:border-[#333333] focus:outline-none transition-colors"
                >
                  {harnessOptions.map((harnessOption) => (
                    <option key={harnessOption.value} value={harnessOption.value}>
                      {harnessOption.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {type === "agent_role" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-[#666666]">Agent</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  disabled={optionsLoading || agentOptions.length <= 1}
                  className="h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] focus:border-[#333333] focus:outline-none transition-colors"
                >
                  {agentOptions.map((agentOption) => (
                    <option key={agentOption.value} value={agentOption.value}>
                      {agentOption.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                id="session-yolo"
                type="checkbox"
                checked={yolo}
                onChange={(e) => setYolo(e.target.checked)}
                disabled={yoloDisabled}
                className="h-4 w-4 rounded border-[#1C1C1C] bg-[#000000] accent-white disabled:opacity-40"
              />
              <label
                htmlFor="session-yolo"
                className={`text-[13px] font-medium ${yoloDisabled ? "text-[#666666]" : "text-[#FFFFFF]"}`}
              >
                Enable YOLO mode
              </label>
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-[#666666] hover:text-[#FFFFFF] hover:bg-[#141414] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  loading ||
                  optionsLoading ||
                  !name.trim() ||
                  (type !== "plain" && harnessOptions.length === 0) ||
                  (type === "agent_role" && role === "plain")
                }
                className="px-4 py-2 text-sm font-medium bg-[#FFFFFF] text-[#000000] hover:bg-[#E5E5E5] rounded-lg transition-colors disabled:opacity-40"
              >
                {loading ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
