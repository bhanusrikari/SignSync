import { Settings, Info } from "lucide-react";

interface FooterProps {
  onSettings: () => void;
  onAbout: () => void;
}

export function Footer({ onSettings, onAbout }: FooterProps) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
      <button
        type="button"
        onClick={onSettings}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <Settings className="h-3.5 w-3.5" />
        Settings
      </button>
      <button
        type="button"
        onClick={onAbout}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <Info className="h-3.5 w-3.5" />
        About
      </button>
    </div>
  );
}
