import React from 'react';
import { ChevronRight, ChevronDown, MoreHorizontal } from 'lucide-react';
import { SessionState } from '@kleiber/shared';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/utils';

export interface SidebarItemProps {
  level: number;
  label: string;
  isActive: boolean;
  isFocused?: boolean;
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
      return 'bg-[#666666]';
  }
};

export const SidebarItem: React.FC<SidebarItemProps> = ({
  level,
  label,
  isActive,
  isFocused = false,
  isExpanded,
  hasChildren,
  statusState,
  yolo,
  onToggle,
  onSelect,
  contextMenuItems,
}) => {
  const indent = Math.min(level, 6) * 14;
  const isDeep = level > 6;

  return (
    <div
      className={cn(
        'group flex items-center h-[30px] w-full cursor-pointer select-none text-[13px] rounded-lg',
        'text-[#999999] hover:bg-[#111111] hover:text-[#FFFFFF] transition-colors',
        isActive && 'bg-[#111111] text-[#FFFFFF]',
        isFocused && !isActive && 'ring-1 ring-inset ring-[#444444] text-[#FFFFFF]',
        isDeep && 'border-l border-dashed border-[#1C1C1C]',
      )}
      style={{
        paddingLeft: isDeep ? '8px' : `${indent + 8}px`,
        paddingRight: '6px',
        marginLeft: isDeep ? `${6 * 14}px` : undefined,
      }}
      onClick={onSelect}
    >
      {/* Chevron toggle */}
      <div
        className="w-4 h-4 flex items-center justify-center mr-0.5 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggle();
        }}
      >
        {hasChildren &&
          (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </div>

      {/* Status dot */}
      {statusState !== null && (
        <div className={cn('w-1.5 h-1.5 rounded-full mr-2 shrink-0', getStatusColor(statusState))} />
      )}

      <span className="truncate flex-1">{label}</span>

      {/* YOLO badge */}
      {yolo && (
        <span className="text-[9px] font-semibold text-[#F97316] ml-1.5 px-1 py-px border border-[#F97316]/25 rounded shrink-0 uppercase tracking-wide">
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
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#1C1C1C] rounded-lg ml-0.5 shrink-0 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={13} />
            </div>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-[160px] bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg p-1 z-50 shadow-xl shadow-black/50"
              sideOffset={4}
            >
              {contextMenuItems.map((item, i) => (
                <DropdownMenu.Item
                  key={i}
                  className={cn(
                    'flex items-center px-2 py-1.5 text-[13px] rounded-lg outline-none cursor-pointer transition-colors',
                    item.destructive
                      ? 'text-[#EF4444] hover:bg-[#EF4444]/10 focus:bg-[#EF4444]/10'
                      : 'text-[#FFFFFF] hover:bg-[#141414] focus:bg-[#141414]',
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
