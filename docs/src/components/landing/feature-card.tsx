import type { ReactNode } from "react";

export function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group rounded-xl border border-fd-border bg-fd-card/50 p-6 transition-all duration-200 hover:border-fd-primary/40 hover:bg-fd-card">
      <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-fd-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
        {description}
      </p>
    </div>
  );
}
