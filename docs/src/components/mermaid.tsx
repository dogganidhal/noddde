"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { useTheme } from "next-themes";

export function Mermaid({ chart }: { chart: string }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      if (!ref.current) return;

      mermaid.initialize({
        startOnLoad: false,
        theme: resolvedTheme === "dark" ? "dark" : "default",
        fontFamily: "inherit",
      });

      ref.current.innerHTML = "";
      const id = `mermaid-${Math.random().toString(36).slice(2)}`;
      const { svg } = await mermaid.render(id, chart);
      if (ref.current) ref.current.innerHTML = svg;
    };

    render();
  }, [chart, resolvedTheme]);

  return <div ref={ref} className="my-4 flex justify-center" />;
}
