import type { MetadataRoute } from "next";
import { source } from "@/lib/source";

export const dynamic = "force-static";

const BASE_URL = "https://noddde.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages();

  const docEntries = pages.map((page) => ({
    url: `${BASE_URL}${page.url}`,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [
    {
      url: BASE_URL,
      changeFrequency: "monthly" as const,
      priority: 1.0,
    },
    ...docEntries,
  ];
}
