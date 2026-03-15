import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

export default defineConfig({
  integrations: [
    starlight({
      title: "noddde",
      description:
        "A TypeScript framework for DDD, CQRS, and Event Sourcing",
      plugins: [
        starlightTypeDoc({
          entryPoints: ["../core/src/index.ts"],
          tsconfig: "../core/tsconfig.json",
          output: "api",
          sidebar: {
            label: "API Reference",
            collapsed: false,
          },
          typeDoc: {
            excludePrivate: true,
            excludeInternal: true,
            readme: "none",
          },
        }),
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quick Start", slug: "getting-started/quick-start" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Defining Aggregates", slug: "guides/aggregates" },
            { label: "Commands & CQRS", slug: "guides/commands-cqrs" },
            { label: "Events & Event Sourcing", slug: "guides/events" },
            { label: "Projections", slug: "guides/projections" },
            {
              label: "Domain Configuration",
              slug: "guides/domain-configuration",
            },
          ],
        },
        typeDocSidebarGroup,
      ],
    }),
  ],
});
