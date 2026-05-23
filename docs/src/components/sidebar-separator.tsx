"use client";

import type { Separator as SeparatorNode } from "fumadocs-core/page-tree";

export function SidebarSectionLabel({ item }: { item: SeparatorNode }) {
  return (
    <p className="mt-5 mb-1 ps-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-fd-muted-foreground/70 first:mt-2">
      {item.icon}
      {item.name}
    </p>
  );
}
