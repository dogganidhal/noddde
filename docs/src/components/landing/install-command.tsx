"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";

export function InstallCommand({
  command = "yarn add @noddde/core",
}: {
  command?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [command]);

  return (
    <button
      type="button"
      onClick={copy}
      className="group flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card px-4 py-2.5 font-mono text-sm text-fd-muted-foreground transition-colors hover:border-fd-primary/40"
    >
      <span className="select-all">$ {command}</span>
      {copied ? (
        <Check className="size-4 text-green-500" />
      ) : (
        <Copy className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}
