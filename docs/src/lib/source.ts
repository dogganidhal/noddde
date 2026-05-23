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
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
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

export const source = loader({
  baseUrl: "/docs",
  source: toFumadocsSource(docs, meta),
  icon: (icon) => {
    if (!icon) return;
    const Icon = icons[icon];
    if (!Icon) return;
    return createElement(Icon, { className: "size-4" });
  },
});
