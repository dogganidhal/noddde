import corePkg from "../../../packages/core/package.json";

type Channel = "stable" | "beta" | "rc" | "alpha" | "next";

function detectChannel(version: string): Channel {
  if (version.includes("alpha")) return "alpha";
  if (version.includes("beta")) return "beta";
  if (version.includes("rc")) return "rc";
  if (version.includes("next")) return "next";
  return "stable";
}

const CHANNEL_STYLES: Record<Channel, string> = {
  stable: "bg-fd-primary/10 text-fd-primary border-fd-primary/20",
  beta: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  rc: "bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400",
  alpha: "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400",
  next: "bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400",
};

const CHANNEL_LABELS: Record<Channel, string | null> = {
  stable: null,
  beta: "beta",
  rc: "rc",
  alpha: "alpha",
  next: "next",
};

export function VersionBadge() {
  const version = corePkg.version;
  const channel = detectChannel(version);
  const channelLabel = CHANNEL_LABELS[channel];

  return (
    <a
      href="https://github.com/dogganidhal/noddde/releases"
      target="_blank"
      rel="noreferrer"
      title={`@noddde/core ${version} — view all releases`}
      className={`hidden sm:inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none tabular-nums transition-colors ${CHANNEL_STYLES[channel]}`}
    >
      <span>v{version}</span>
      {channelLabel ? (
        <span className="uppercase tracking-wide opacity-70">
          {channelLabel}
        </span>
      ) : null}
    </a>
  );
}
