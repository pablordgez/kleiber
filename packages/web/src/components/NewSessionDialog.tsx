import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ApiClient } from "../api/api";

interface NewSessionDialogProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}

export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({ projectId, isOpen, onClose, onCreated }) => {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    setError("");
    try {
      const session = await ApiClient.createSession(projectId, {
        name,
        type: "plain",
      });
      setName("");
      onCreated(session.id);
    } catch (err: any) {
      setError(err.message || "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
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
                disabled={loading || !name.trim()}
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
