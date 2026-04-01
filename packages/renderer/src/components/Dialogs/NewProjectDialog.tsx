import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Project } from '@kleiber/shared';
import { X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

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
  const [yoloDefault, setYoloDefault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const addProject = useAppStore((state) => state.addProject);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !directoryPath) return;

    setIsSubmitting(true);
    try {
      const project = await window.kleiber.projects.create({ name, directoryPath, yoloDefault });
      addProject(project);
      onCreated?.(project);
      onOpenChange(false);
      setName('');
      setDirectoryPath('');
      setYoloDefault(false);
    } catch (err) {
      console.error('Failed to create project', err);
      window.alert('Failed to create project: ' + (err instanceof Error ? err.message : err));
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
              New Project
            </Dialog.Title>
            <Dialog.Close className="text-[#666666] hover:text-[#FFFFFF] rounded-lg p-0.5 transition-colors">
              <X size={18} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-name" className="text-[13px] font-medium text-[#FFFFFF]">
                Name
              </label>
              <input
                id="proj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] placeholder:text-[#444444] focus:outline-none focus:border-[#333333] transition-colors"
                placeholder="My Awesome Project"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-directory" className="text-[13px] font-medium text-[#FFFFFF]">
                Directory Path
              </label>
              <input
                id="proj-directory"
                value={directoryPath}
                onChange={(e) => setDirectoryPath(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] placeholder:text-[#444444] focus:outline-none focus:border-[#333333] transition-colors"
                placeholder="/path/to/project"
                required
              />
            </div>

            <div className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                id="proj-yolo"
                checked={yoloDefault}
                onChange={(e) => setYoloDefault(e.target.checked)}
                className="h-4 w-4 rounded border-[#1C1C1C] bg-[#000000] accent-white"
              />
              <label htmlFor="proj-yolo" className="text-[13px] font-medium text-[#FFFFFF]">
                Enable YOLO mode by default
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
