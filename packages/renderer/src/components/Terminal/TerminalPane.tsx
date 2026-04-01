import React from 'react';
import { UUID } from '@kleiber/shared';

export interface TerminalPaneProps {
  sessionId: UUID;
  sessionName: string;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ sessionId, sessionName }) => {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#09090B] text-[#A1A1AA] font-mono text-sm">
      <div className="text-center">
        <p>Terminal placeholder (M3)</p>
        <p className="text-xs mt-2 opacity-50">
          Session: {sessionName} ({sessionId})
        </p>
      </div>
    </div>
  );
};
