import { Hand } from "lucide-react";

interface HeaderProps {
  enabled: boolean;
}

export function Header({ enabled }: HeaderProps) {
  return (
    <div className="flex items-center justify-between bg-brand-600 px-4 py-3.5 text-white">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
          <Hand className="h-4.5 w-4.5" />
        </span>
        <div>
          <p className="text-sm font-bold leading-tight">SignSync</p>
          <p className="text-[11px] leading-tight text-brand-50">AI Accessibility Companion</p>
        </div>
      </div>
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          enabled ? "bg-emerald-400 text-emerald-950" : "bg-white/20 text-white"
        }`}
      >
        {enabled ? "Enabled" : "Disabled"}
      </span>
    </div>
  );
}
