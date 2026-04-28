import { clsx } from "clsx";
import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-medium text-fg-3">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={clsx(
          "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-4",
          "focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand/50",
          error ? "border-err" : "border-line",
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-err">{error}</p>}
    </div>
  );
}
