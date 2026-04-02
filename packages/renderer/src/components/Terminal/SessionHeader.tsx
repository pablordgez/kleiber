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
  onDelete: () => void;
}

export const SessionHeader: React.FC<SessionHeaderProps> = ({
  session,
  projectName,
  ancestorNames,
  onKill,
  onDelete,
}) => {
  const sessionName = getSessionDisplayName(session);
  const breadcrumbs = [projectName, ...ancestorNames, sessionName];

  return (
    <div className="h-9 w-full bg-[#000000] border-b border-[#1C1C1C] flex items-center px-4 justify-between select-none shrink-0">
      {/* Left: breadcrumb + badges */}
      <div className="flex items-center gap-2 overflow-hidden">
        <div className="flex items-center text-[13px] text-[#666666] truncate">
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span className="mx-1.5 text-[#333333]">/</span>}
              <span className={idx === breadcrumbs.length - 1 ? 'text-[#FFFFFF] font-medium' : ''}>
                {crumb}
              </span>
            </React.Fragment>
          ))}
        </div>

        {session.cli && (
          <span className="px-1.5 py-0.5 text-[10px] font-mono text-[#666666] bg-[#0A0A0A] rounded-lg shrink-0">
            {session.cli}
          </span>
        )}

        {session.yolo && (
          <span className="px-1.5 py-0.5 text-[9px] font-semibold text-[#F97316] border border-[#F97316]/25 rounded shrink-0 uppercase tracking-wide">
            YOLO
          </span>
        )}
      </div>

      {/* Right: kill + more */}
      <div className="flex items-center gap-1 shrink-0">
        {session.state === 'exited' ? (
          <Popover.Root>
            <Popover.Trigger asChild>
              <button className="text-xs text-[#EF4444] hover:bg-[#EF4444]/10 px-2 py-1 rounded-lg transition-colors flex items-center gap-1">
                <X size={13} />
                Delete
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg p-4 z-50 w-60 shadow-xl shadow-black/50"
                sideOffset={4}
              >
                <p className="text-sm text-[#FFFFFF] mb-4">
                  Delete this stopped session from Kleiber?
                </p>
                <div className="flex justify-end gap-2">
                  <Popover.Close asChild>
                    <button className="px-3 py-1.5 text-xs text-[#666666] hover:bg-[#141414] rounded-lg transition-colors">
                      Cancel
                    </button>
                  </Popover.Close>
                  <Popover.Close asChild>
                    <button
                      onClick={onDelete}
                      className="px-3 py-1.5 text-xs bg-[#EF4444] text-white hover:bg-[#DC2626] rounded-lg transition-colors"
                    >
                      Delete Session
                    </button>
                  </Popover.Close>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <Popover.Root>
            <Popover.Trigger asChild>
              <button className="text-xs text-[#EF4444] hover:bg-[#EF4444]/10 px-2 py-1 rounded-lg transition-colors flex items-center gap-1">
                <X size={13} />
                Kill
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg p-4 z-50 w-60 shadow-xl shadow-black/50"
                sideOffset={4}
              >
                <p className="text-sm text-[#FFFFFF] mb-4">
                  Kill this session?
                </p>
                <div className="flex justify-end gap-2">
                  <Popover.Close asChild>
                    <button className="px-3 py-1.5 text-xs text-[#666666] hover:bg-[#141414] rounded-lg transition-colors">
                      Cancel
                    </button>
                  </Popover.Close>
                  <Popover.Close asChild>
                    <button
                      onClick={onKill}
                      className="px-3 py-1.5 text-xs bg-[#EF4444] text-white hover:bg-[#DC2626] rounded-lg transition-colors"
                    >
                      Kill Session
                    </button>
                  </Popover.Close>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="text-[#666666] hover:text-[#FFFFFF] hover:bg-[#0A0A0A] p-1 rounded-lg transition-colors">
              <MoreHorizontal size={15} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-[160px] bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg p-1 z-50 shadow-xl shadow-black/50"
              sideOffset={4}
            >
              <DropdownMenu.Item className="flex items-center px-2 py-1.5 text-[13px] text-[#FFFFFF] hover:bg-[#141414] focus:bg-[#141414] rounded-lg outline-none cursor-pointer transition-colors">
                Clear Terminal
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
};
