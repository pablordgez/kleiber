import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Project } from '@kleiber/shared';
import { FolderOpen, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

function basename(filePath: string): string {
  const normalized = filePath.replace(/\/+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

const ALL_PROVIDERS = ['anthropic', 'openai', 'google'];

interface ModelRow {
  provider: string;
  model: string;
}

export interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (project: Project) => void;
}

export const NewProjectDialog: React.FC<NewProjectDialogProps> = ({
  open,
  onOpenChange,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [directoryPath, setDirectoryPath] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingDirectory, setIsPickingDirectory] = useState(false);
  const [detectedProviders, setDetectedProviders] = useState<string[]>([]);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [lowComplexity, setLowComplexity] = useState<ModelRow>({ provider: '', model: '' });
  const [mediumComplexity, setMediumComplexity] = useState<ModelRow>({ provider: '', model: '' });
  const [highComplexity, setHighComplexity] = useState<ModelRow>({ provider: '', model: '' });
  const [notes, setNotes] = useState('');
  const addProject = useAppStore((state) => state.addProject);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const providers = await window.kleiber.pack.detectProviders();
        setDetectedProviders(providers);
        setSelectedProviders(providers);
        const defaultProvider = providers[0] ?? '';
        setLowComplexity({ provider: defaultProvider, model: '' });
        setMediumComplexity({ provider: defaultProvider, model: '' });
        setHighComplexity({ provider: defaultProvider, model: '' });
      } catch {
        setDetectedProviders([]);
        setSelectedProviders([]);
      }
    })();
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !directoryPath) return;

    setIsSubmitting(true);
    try {
      const hasConfigData =
        selectedProviders.length > 0 ||
        lowComplexity.model.trim() ||
        mediumComplexity.model.trim() ||
        highComplexity.model.trim() ||
        notes.trim();

      const packConfig = hasConfigData
        ? {
            allowedProviders: selectedProviders,
            models: {
              lowComplexity: {
                provider: lowComplexity.provider || selectedProviders[0] || '',
                model: lowComplexity.model.trim(),
              },
              mediumComplexity: {
                provider: mediumComplexity.provider || selectedProviders[0] || '',
                model: mediumComplexity.model.trim(),
              },
              highComplexity: {
                provider: highComplexity.provider || selectedProviders[0] || '',
                model: highComplexity.model.trim(),
              },
            },
            notes: notes.trim(),
          }
        : undefined;

      const project = await window.kleiber.projects.create({
        name,
        directoryPath,
        ...(packConfig ? { packConfig } : {}),
      });
      addProject(project);
      onCreated?.(project);
      onOpenChange(false);
      resetForm();
    } catch (err) {
      console.error('Failed to create project', err);
      window.alert('Failed to create project: ' + (err instanceof Error ? err.message : err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDirectoryPath('');
    setDetectedProviders([]);
    setSelectedProviders([]);
    setLowComplexity({ provider: '', model: '' });
    setMediumComplexity({ provider: '', model: '' });
    setHighComplexity({ provider: '', model: '' });
    setNotes('');
  };

  const handlePickDirectory = async () => {
    setIsPickingDirectory(true);
    try {
      const selectedPath = await window.kleiber.projects.pickDirectory();
      if (!selectedPath) return;
      setDirectoryPath(selectedPath);
      setName((currentName) => currentName || basename(selectedPath));
    } catch (err) {
      console.error('Failed to pick project directory', err);
      window.alert('Failed to pick project directory: ' + (err instanceof Error ? err.message : err));
    } finally {
      setIsPickingDirectory(false);
    }
  };

  const toggleProvider = (provider: string) => {
    setSelectedProviders((prev) =>
      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider],
    );
  };

  const providerOptions = selectedProviders.length > 0 ? selectedProviders : ALL_PROVIDERS;

  const inputClass =
    'flex h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] placeholder:text-[#444444] focus:outline-none focus:border-[#333333] transition-colors';
  const selectClass =
    'flex h-9 rounded-lg border border-[#1C1C1C] bg-[#000000] px-2 py-2 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#333333] transition-colors';
  const labelClass = 'text-[13px] font-medium text-[#FFFFFF]';
  const sublabelClass = 'text-[12px] text-[#888888]';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] max-h-[90vh] flex flex-col bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg z-50 shadow-xl shadow-black/50">
          <div className="flex items-center justify-between p-6 pb-4 shrink-0">
            <Dialog.Title className="text-base font-semibold text-[#FFFFFF]">
              New Project
            </Dialog.Title>
            <Dialog.Close className="text-[#666666] hover:text-[#FFFFFF] rounded-lg p-0.5 transition-colors">
              <X size={18} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-0 overflow-hidden">
            <div className="flex flex-col gap-4 px-6 overflow-y-auto">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="proj-name" className={labelClass}>Name</label>
                <input
                  id="proj-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder="My Awesome Project"
                  required
                />
              </div>

              {/* Directory */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="proj-directory" className={labelClass}>Directory Path</label>
                <div className="flex items-center gap-2">
                  <input
                    id="proj-directory"
                    value={directoryPath}
                    onChange={(e) => setDirectoryPath(e.target.value)}
                    className={inputClass}
                    placeholder="/absolute/path/to/project"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => void handlePickDirectory()}
                    disabled={isSubmitting || isPickingDirectory}
                    className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#1C1C1C] bg-[#141414] px-3 text-sm font-medium text-[#FFFFFF] transition-colors hover:bg-[#1A1A1A] disabled:opacity-40"
                  >
                    <FolderOpen size={14} />
                    {isPickingDirectory ? 'Browsing…' : 'Browse'}
                  </button>
                </div>
                <p className="text-xs text-[#666666]">
                  Choose a directory from the native folder picker or paste an absolute path.
                </p>
              </div>

              {/* Config section */}
              <div className="border-t border-[#1C1C1C] pt-4">
                <p className={`${sublabelClass} mb-3`}>
                  Agent pack configuration (saved to <code className="text-[#888888] text-[11px]">.agent_specs/agent_pack_config.yaml</code>)
                </p>

                {/* Providers */}
                <div className="flex flex-col gap-1.5 mb-4">
                  <label className={labelClass}>Providers</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_PROVIDERS.map((provider) => {
                      const isDetected = detectedProviders.includes(provider);
                      const isSelected = selectedProviders.includes(provider);
                      return (
                        <button
                          key={provider}
                          type="button"
                          onClick={() => toggleProvider(provider)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                            isSelected
                              ? 'border-[#444444] bg-[#1A1A1A] text-[#FFFFFF]'
                              : 'border-[#1C1C1C] bg-transparent text-[#555555] hover:text-[#888888]'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isDetected ? 'bg-green-500' : 'bg-[#444444]'
                            }`}
                          />
                          {provider}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-[#555555]">
                    Green dot = API key detected in environment.
                  </p>
                </div>

                {/* Models */}
                <div className="flex flex-col gap-2 mb-4">
                  <label className={labelClass}>Default Models</label>
                  {(
                    [
                      { label: 'Low complexity', value: lowComplexity, setter: setLowComplexity },
                      { label: 'Medium complexity', value: mediumComplexity, setter: setMediumComplexity },
                      { label: 'High complexity', value: highComplexity, setter: setHighComplexity },
                    ] as const
                  ).map(({ label, value, setter }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-[12px] text-[#666666] w-[130px] shrink-0">{label}</span>
                      <select
                        value={value.provider}
                        onChange={(e) => setter((prev) => ({ ...prev, provider: e.target.value }))}
                        className={`${selectClass} w-[120px] shrink-0`}
                      >
                        {selectedProviders.length === 0 && (
                          <option value="">provider</option>
                        )}
                        {providerOptions.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={value.model}
                        onChange={(e) => setter((prev) => ({ ...prev, model: e.target.value }))}
                        className={`${inputClass} flex-1`}
                        placeholder="model name"
                      />
                    </div>
                  ))}
                </div>

                {/* Notes */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="proj-notes" className={labelClass}>Notes</label>
                  <textarea
                    id="proj-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] placeholder:text-[#444444] focus:outline-none focus:border-[#333333] transition-colors resize-none"
                    placeholder="Optional notes for agents about this project's AI configuration…"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#1C1C1C] shrink-0">
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
                disabled={isSubmitting || !name || !directoryPath}
                className="px-4 py-2 text-sm font-medium bg-[#FFFFFF] text-[#000000] hover:bg-[#E5E5E5] rounded-lg transition-colors disabled:opacity-40"
              >
                {isSubmitting ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
