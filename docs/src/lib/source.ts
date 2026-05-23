import { docs, meta } from "collections/server";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { loader } from "fumadocs-core/source";
import { createElement } from "react";
import {
  Rocket,
  BookOpen,
  Boxes,
  Workflow,
  Eye,
  Cog,
  FlaskConical,
  Compass,
  Plug,
  Lightbulb,
  HelpCircle,
  PlayCircle,
  Map as MapIcon,
  Terminal,
  FolderTree,
  MessageSquare,
  Hash,
  GitBranch,
  Split,
  Box,
  Zap,
  History,
  Route,
  Sparkles,
  Layers,
  Database,
  Search,
  RefreshCw,
  Send,
  Radio,
  Settings2,
  Server,
  ScrollText,
  Activity,
  ShieldCheck,
  CheckCircle2,
  CheckCheck,
  TestTube2,
  Clock,
  Hammer,
  Flame,
  Hotel,
  type LucideIcon,
} from "lucide-react";

const FOLDER_ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  book: BookOpen,
  boxes: Boxes,
  workflow: Workflow,
  eye: Eye,
  cog: Cog,
  flask: FlaskConical,
  compass: Compass,
  plug: Plug,
  lightbulb: Lightbulb,
};

const ITEM_ICONS: Record<string, LucideIcon> = {
  "/docs/getting-started/why-noddde": HelpCircle,
  "/docs/getting-started/quick-start": PlayCircle,
  "/docs/getting-started/introduction": MapIcon,
  "/docs/getting-started/cli": Terminal,
  "/docs/getting-started/project-structure": FolderTree,

  "/docs/core-concepts/messages-and-types": MessageSquare,
  "/docs/core-concepts/id-types": Hash,
  "/docs/core-concepts/decider-pattern": GitBranch,
  "/docs/core-concepts/cqrs-and-event-sourcing": Split,

  "/docs/modeling/defining-aggregates": Box,
  "/docs/modeling/command-handlers": Zap,
  "/docs/modeling/state-and-events": History,
  "/docs/modeling/routing-and-dispatch": Route,
  "/docs/modeling/type-inference": Sparkles,
  "/docs/modeling/event-versioning": Layers,

  "/docs/read-model/projections": Eye,
  "/docs/read-model/view-persistence": Database,
  "/docs/read-model/queries": Search,
  "/docs/read-model/projection-rebuild": RefreshCw,

  "/docs/process-managers/sagas": Workflow,
  "/docs/process-managers/standalone-commands": Send,
  "/docs/process-managers/standalone-events": Radio,

  "/docs/running/domain-configuration": Settings2,
  "/docs/running/infrastructure": Server,
  "/docs/running/logging": ScrollText,
  "/docs/running/observability": Activity,
  "/docs/running/idempotent-commands": ShieldCheck,
  "/docs/running/outbox-pattern": Send,
  "/docs/running/persistence": Database,
  "/docs/running/persistence-adapters": Plug,
  "/docs/running/event-bus-adapters": Radio,

  "/docs/testing/overview": BookOpen,
  "/docs/testing/testing-aggregates-and-projections": CheckCircle2,
  "/docs/testing/testing-sagas": CheckCheck,
  "/docs/testing/testing-domains": TestTube2,

  "/docs/patterns/clock-pattern": Clock,
  "/docs/patterns/auction-domain": Hammer,
  "/docs/patterns/flash-sale": Flame,
  "/docs/patterns/hotel-booking": Hotel,

  "/docs/integrations/nestjs": Boxes,
};

function renderIcon(Icon: LucideIcon) {
  return createElement(Icon, { className: "size-4" });
}

export const source = loader({
  baseUrl: "/docs",
  source: toFumadocsSource(docs, meta),
  icon: (icon) => {
    if (!icon) return;
    const Icon = FOLDER_ICONS[icon];
    if (!Icon) return;
    return renderIcon(Icon);
  },
  pageTree: {
    transformers: [
      {
        file(node) {
          if (node.icon) return node;
          const Icon = ITEM_ICONS[node.url];
          if (Icon) node.icon = renderIcon(Icon);
          return node;
        },
      },
    ],
  },
});
