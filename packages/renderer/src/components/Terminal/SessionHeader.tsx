import React from 'react';
import { Session } from '@kleiber/shared';
import { MoreHorizontal, X } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';

function getSessionDisplayName(session: Session): string {
  return (session as Session & { name?: string }).name ?? session.id.substring(0, 8);
}

export interface SessionHeaderProps {
  session: Session;
  projectName: string;
  ancestorNames: string[];
  onKill: () => void;
}

export const SessionHeader: React.FC<SessionHeaderProps> = ({
  session,
  projectName,
  ancestorNames,
  onKill,
}) => {
  const sessionName = getSessionDisplayName(session);
  const breadcrumbs = [projectName, ...ancestorNames, sessionName];

  return (
    <div className="h-[32px] w-full bg-[#18181B] border-b border-[#3F3F46] flex items-center px-4 justify-between select-none shrink-0">
      {/* Left: breadcrumb + badges */}
      <div className="flex items-center gap-2 overflow-hidden">
        <div className="flex items-center text-sm text-[#A1A1AA] truncate">
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span className="mx-1 text-[#3F3F46]">›</span>}
              <span className={idx === breadcrumbs.length - 1 ? 'text-[#FAFAFA]' : ''}>
                {crumb}
              </span>
            </React.Fragment>
          ))}
        </div>

        {session.cli && (
          <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-[#27272A] text-[#A1A1AA] rounded-full border border-[#3F3F46] shrink-0">
            {session.cli}
          </span>
        )}

        {session.yolo && (
          <span className="px-2 py-0.5 text-[10px] font-bold text-[#F97316] border border-[#F97316]/30 rounded-full shrink-0">
            YOLO
          </span>
        )}
      </div>

      {/* Right: kill + more */}
      <div className="flex items-center gap-2 shrink-0">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button className="text-xs text-[#EF4444] hover:bg-[#EF4444]/10 px-2 py-1 rounded transition-colors duration-150 ease-out flex items-center gap-1">
              <X size={14} />
              Kill
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="bg-[#18181B] border border-[#3F3F46] rounded-md p-4 z-50 w-64"
              sideOffset={5}
            >
              <p className="text-sm text-[#FAFAFA] mb-4">
                Are you sure you want to kill this session?
              </p>
              <div className="flex justify-end gap-2">
                <Popover.Close asChild>
                  <button className="px-3 py-1.5 text-xs text-[#A1A1AA] hover:bg-[#27272A] rounded transition-colors">
                    Cancel
                  </button>
                </Popover.Close>
                <Popover.Close asChild>
                  <button
                    onClick={onKill}
                    className="px-3 py-1.5 text-xs bg-[#EF4444] text-white hover:bg-[#EF4444]/90 rounded transition-colors"
                  >
                    Kill Session
                  </button>
                </Popover.Close>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#27272A] p-1 rounded transition-colors duration-150 ease-out">
              <MoreHorizontal size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-[160px] bg-[#18181B] border border-[#3F3F46] rounded-md p-1 z-50"
              sideOffset={5}
            >
              <DropdownMenu.Item className="flex items-center px-2 py-1.5 text-sm text-[#FAFAFA] hover:bg-[#27272A] focus:bg-[#27272A] rounded outline-none cursor-pointer">
                Clear Terminal
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
};
