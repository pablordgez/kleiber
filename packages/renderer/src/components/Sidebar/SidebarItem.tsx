import React from 'react';
import { ChevronRight, ChevronDown, MoreHorizontal } from 'lucide-react';
import { SessionState } from '@kleiber/shared';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/utils';

export interface SidebarItemProps {
  level: number;
  label: string;
  isActive: boolean;
  isExpanded: boolean;
  hasChildren: boolean;
  statusState: SessionState | null;
  yolo: boolean;
  onToggle: () => void;
  onSelect: () => void;
  contextMenuItems: Array<{ label: string; onClick: () => void; destructive?: boolean }>;
}

const getStatusColor = (state: SessionState | null): string => {
  switch (state) {
    case 'running':
      return 'bg-[#22C55E]';
    case 'starting':
      return 'bg-[#F59E0B]';
    case 'exited':
      return 'bg-[#EF4444]';
    default:
      return 'bg-[#A1A1AA]';
  }
};

export const SidebarItem: React.FC<SidebarItemProps> = ({
  level,
  label,
  isActive,
  isExpanded,
  hasChildren,
  statusState,
  yolo,
  onToggle,
  onSelect,
  contextMenuItems,
}) => {
  const indent = Math.min(level, 6) * 16;
  const isDeep = level > 6;

  return (
    <div
      className={cn(
        'group flex items-center h-[32px] w-full cursor-pointer select-none text-sm text-[#A1A1AA]',
        'hover:bg-[#27272A] hover:text-[#FAFAFA] transition-colors duration-150 ease-out',
        isActive && 'bg-[#27272A] text-[#FAFAFA]',
        isDeep && 'border-l border-dashed border-[#3F3F46]',
      )}
      style={{
        paddingLeft: isDeep ? '8px' : `${indent + 8}px`,
        paddingRight: '8px',
        marginLeft: isDeep ? `${6 * 16}px` : undefined,
      }}
      onClick={onSelect}
    >
      {/* Chevron toggle */}
      <div
        className="w-4 h-4 flex items-center justify-center mr-1 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggle();
        }}
      >
        {hasChildren &&
          (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </div>

      {/* Status dot */}
      {statusState !== null && (
        <div className={cn('w-2 h-2 rounded-full mr-2 shrink-0', getStatusColor(statusState))} />
      )}

      <span className="truncate flex-1">{label}</span>

      {/* YOLO badge */}
      {yolo && (
        <span className="text-[10px] font-bold text-[#F97316] ml-2 px-1 border border-[#F97316]/30 rounded shrink-0">
          YOLO
        </span>
      )}

      {/* Context menu */}
      {contextMenuItems.length > 0 && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <div
              role="button"
              aria-label="More options"
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#3F3F46] rounded ml-1 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={14} />
            </div>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-[160px] bg-[#18181B] border border-[#3F3F46] rounded-md p-1 z-50"
              sideOffset={5}
            >
              {contextMenuItems.map((item, i) => (
                <DropdownMenu.Item
                  key={i}
                  className={cn(
                    'flex items-center px-2 py-1.5 text-sm rounded outline-none cursor-pointer',
                    item.destructive
                      ? 'text-[#EF4444] hover:bg-[#EF4444]/10 focus:bg-[#EF4444]/10'
                      : 'text-[#FAFAFA] hover:bg-[#27272A] focus:bg-[#27272A]',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    item.onClick();
                  }}
                >
                  {item.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
};
