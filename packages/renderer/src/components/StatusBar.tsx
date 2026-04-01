import React from 'react';
import { Server } from 'lucide-react';

export interface StatusBarProps {
  remoteApiEnabled: boolean;
  remoteApiPort: number | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({ remoteApiEnabled, remoteApiPort }) => {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#0A0A0A] text-xs">
      <Server
        size={13}
        className={remoteApiEnabled ? 'text-[#22C55E]' : 'text-[#666666]'}
      />
      <span className={remoteApiEnabled ? 'text-[#FFFFFF]' : 'text-[#666666]'}>
        Remote API
      </span>
      {remoteApiEnabled && remoteApiPort !== null && (
        <span className="ml-auto text-[#666666] font-mono text-[11px]">{remoteApiPort}</span>
      )}
    </div>
  );
};
