import { select } from "@inquirer/prompts";

/** Supported persistence adapters for project scaffolding. */
export type PersistenceAdapter = "in-memory" | "prisma" | "drizzle" | "typeorm";

/** Prompts the user to choose a persistence adapter. */
export async function promptPersistenceAdapter(): Promise<PersistenceAdapter> {
  return select({
    message: "Which persistence adapter?",
    choices: [
      {
        name: "In-memory (no external dependencies)",
        value: "in-memory" as const,
      },
      {
        name: "Prisma (SQLite via @noddde/prisma)",
        value: "prisma" as const,
      },
      {
        name: "Drizzle (SQLite via @noddde/drizzle)",
        value: "drizzle" as const,
      },
      {
        name: "TypeORM (@noddde/typeorm)",
        value: "typeorm" as const,
      },
    ],
  });
}
