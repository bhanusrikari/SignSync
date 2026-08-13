import type { ReactNode } from "react";

interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
  icon?: ReactNode;
}

export function ToggleSwitch({
  id,
  checked,
  onChange,
  disabled,
  label,
  description,
  icon,
}: ToggleSwitchProps) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 transition-colors ${
        disabled ? "opacity-50" : "hover:bg-slate-50"
      }`}
    >
      <span className="flex items-center gap-2.5">
        {icon && <span className="text-slate-500">{icon}</span>}
        <span className="flex flex-col">
          <span className="text-sm font-medium text-slate-800">{label}</span>
          {description && <span className="text-xs text-slate-400">{description}</span>}
        </span>
      </span>

      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
          checked ? "bg-brand-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-1"
          }`}
        />
      </button>
    </label>
  );
}
