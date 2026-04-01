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
        <Dialog.Overlay className="fixed inset-0 bg-[#09090B]/80 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#18181B] border border-[#3F3F46] rounded-lg z-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-medium text-[#FAFAFA]">
              New Project
            </Dialog.Title>
            <Dialog.Close className="text-[#A1A1AA] hover:text-[#FAFAFA] rounded-sm opacity-70 hover:opacity-100 transition-opacity">
              <X size={20} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="proj-name" className="text-sm font-medium text-[#FAFAFA]">
                Name
              </label>
              <input
                id="proj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex h-10 w-full rounded-md border border-[#3F3F46] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#FAFAFA]"
                placeholder="My Awesome Project"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="proj-directory" className="text-sm font-medium text-[#FAFAFA]">
                Directory Path
              </label>
              <input
                id="proj-directory"
                value={directoryPath}
                onChange={(e) => setDirectoryPath(e.target.value)}
                className="flex h-10 w-full rounded-md border border-[#3F3F46] bg-[#09090B] px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#FAFAFA]"
                placeholder="/path/to/project"
                required
              />
            </div>

            <div className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                id="proj-yolo"
                checked={yoloDefault}
                onChange={(e) => setYoloDefault(e.target.checked)}
                className="h-4 w-4 rounded border-[#3F3F46] bg-[#09090B]"
              />
              <label htmlFor="proj-yolo" className="text-sm font-medium text-[#FAFAFA]">
                Enable YOLO mode by default
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
                disabled={isSubmitting || !name || !directoryPath}
                className="px-4 py-2 text-sm font-medium bg-[#FAFAFA] text-[#09090B] hover:bg-[#FAFAFA]/90 rounded-md transition-colors disabled:opacity-50"
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
