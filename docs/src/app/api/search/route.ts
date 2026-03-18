import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Static search: index is pre-built at build time and served as a static
// JSON payload. Clients download the index once and search entirely
// client-side — no server needed at runtime.
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  language: "english",
});
