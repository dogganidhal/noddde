import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import { remarkAutoTypeTable, createGenerator } from "fumadocs-typescript";

const generator = createGenerator();

export const { docs, meta } = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [[remarkAutoTypeTable, { generator }]],
    // Shallow-merged on top of fumadocs defaults (which provide `themes`),
    // so the partial is safe at runtime. The Shiki type insists on the full
    // shape, hence the cast.
    rehypeCodeOptions: {
      addLanguageClass: true,
    } as never,
  },
});
