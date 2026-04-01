import React from 'react';
import { Server } from 'lucide-react';
import { cn } from '../lib/utils';

export interface StatusBarProps {
  remoteApiEnabled: boolean;
  remoteApiPort: number | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({ remoteApiEnabled, remoteApiPort }) => {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#18181B] border border-[#3F3F46] text-xs font-medium">
      <Server
        size={14}
        className={cn(remoteApiEnabled ? 'text-[#22C55E]' : 'text-[#A1A1AA]')}
      />
      <span className={cn(remoteApiEnabled ? 'text-[#FAFAFA]' : 'text-[#A1A1AA]')}>
        Remote API
      </span>
      {remoteApiEnabled && remoteApiPort !== null && (
        <span className="ml-auto text-[#A1A1AA] font-mono">{remoteApiPort}</span>
      )}
    </div>
  );
};
