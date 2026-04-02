import React, { useEffect, useState } from 'react';
import { CheckCircle, Loader, XCircle } from 'lucide-react';
import { AgentCli } from '@kleiber/shared';

interface CliEntry {
  cli: AgentCli;
  label: string;
  description: string;
  detected: boolean | null;
}

const CLI_META: Array<Omit<CliEntry, 'detected'>> = [
  {
    cli: 'claude',
    label: 'Claude Code',
    description: "Anthropic's official CLI agent (`claude`).",
  },
  {
    cli: 'codex',
    label: 'Codex CLI',
    description: "OpenAI's Codex command-line tool (`codex`).",
  },
  {
    cli: 'opencode',
    label: 'OpenCode',
    description: 'Open-source coding agent (`opencode`).',
  },
  {
    cli: 'gemini',
    label: 'Gemini CLI',
    description: "Google's Gemini command-line agent (`gemini`).",
  },
];

export const CliSettings: React.FC = () => {
  const [entries, setEntries] = useState<CliEntry[]>(
    CLI_META.map((entry) => ({ ...entry, detected: null })),
  );

  useEffect(() => {
    let cancelled = false;

    const detect = async () => {
      const results = await Promise.all(
        CLI_META.map(async (entry) => ({
          ...entry,
          detected: await window.kleiber.pack.detectCli(entry.cli).catch(() => null),
        })),
      );

      if (!cancelled) {
        setEntries(results);
      }
    };

    void detect();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[#FFFFFF] mb-1">Agent CLIs</h2>
        <p className="text-sm text-[#666666]">
          Detection checks whether each CLI binary is currently available on the app&apos;s PATH.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <div
            key={entry.cli}
            className="flex items-center justify-between px-4 py-3 rounded-lg border border-[#1C1C1C] bg-[#0A0A0A]"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-[#FFFFFF]">{entry.label}</span>
              <span className="text-xs text-[#666666]">{entry.description}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-4">
              {entry.detected === null ? (
                <>
                  <Loader size={14} className="text-[#666666] animate-spin" />
                  <span className="text-xs text-[#666666]">Checking…</span>
                </>
              ) : entry.detected ? (
                <>
                  <CheckCircle size={14} className="text-[#22C55E]" />
                  <span className="text-xs text-[#22C55E]">Detected</span>
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-[#666666]" />
                  <span className="text-xs text-[#666666]">Not detected</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[#666666]">
        If you install a CLI while the app is open, reopen Settings to refresh detection.
      </p>
    </div>
  );
};
