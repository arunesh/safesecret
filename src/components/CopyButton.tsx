import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "./icons.js";

interface Props {
  value: string;
  label?: string;
  className?: string;
}

export function CopyButton({ value, label = "Copy", className = "button secondary" }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be denied (insecure context, permissions policy).
      // Silently leaving the button inert would be worse than saying nothing:
      // the value is on screen and selectable either way.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : label}
      <span aria-live="polite" className="visually-hidden">
        {copied ? `${label} copied to clipboard` : ""}
      </span>
    </button>
  );
}
