---
"@noddde/drizzle": patch
---

Document and add regression coverage for the pg/mysql timestamp format change introduced alongside `mode: "string"` (see the `1.0.0-rc.0` patch notes): mid-migration deployments mixing old ISO-with-`Z` rows and new space-separated rows sort correctly under `ORDER BY created_at` on both dialects, since `created_at`/`published_at` are native `TIMESTAMPTZ`/`TIMESTAMP(3)` columns and comparisons happen on the parsed temporal value, not the original text. See the new "Upgrading" section in the `@noddde/drizzle` README for details.
