import React, { useMemo } from 'react';
import { AppSettings, Theme } from '@kleiber/shared';

interface GeneralSettingsProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({ settings, onUpdate }) => {
  const themes: Array<{ value: Theme; label: string }> = useMemo(
    () => [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-[#FFFFFF] mb-1">General</h2>
        <p className="text-sm text-[#666666]">Application-wide preferences.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-medium text-[#FFFFFF]">Theme</label>
          <div className="flex gap-2">
            {themes.map((t) => (
              <button
                key={t.value}
                onClick={() => onUpdate({ theme: t.value })}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  settings.theme === t.value
                    ? 'bg-[#FFFFFF] text-[#000000] border-[#FFFFFF]'
                    : 'bg-transparent text-[#666666] border-[#1C1C1C] hover:border-[#333333] hover:text-[#FFFFFF]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-[#666666]">
            Theme changes apply immediately.
          </p>
        </div>
      </div>
    </div>
  );
};
