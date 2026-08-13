import { Languages } from "lucide-react";
import { LANGUAGES } from "@/shared/constants";
import type { LanguageCode } from "@/types";

interface LanguageSelectorProps {
  value: LanguageCode;
  onChange: (value: LanguageCode) => void;
  disabled?: boolean;
}

export function LanguageSelector({ value, onChange, disabled }: LanguageSelectorProps) {
  return (
    <label className={`flex flex-col gap-1.5 ${disabled ? "opacity-50" : ""}`}>
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Languages className="h-3.5 w-3.5" />
        Language
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as LanguageCode)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed"
      >
        {Object.values(LANGUAGES).map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.name}
          </option>
        ))}
      </select>
    </label>
  );
}
