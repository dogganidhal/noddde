import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

export interface StartedPostgres {
  container: StartedPostgreSqlContainer;
  /** Connection URI suitable for `pg`, `drizzle/node-postgres`, Prisma. */
  url: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  stop: () => Promise<void>;
}

/**
 * Starts a postgres:16 container. The image is intentionally pinned so test
 * runs are reproducible; bump deliberately when we want to pick up a new
 * dialect feature.
 */
export async function startPostgres(
  opts: {
    image?: string;
    database?: string;
  } = {},
): Promise<StartedPostgres> {
  const image = opts.image ?? "postgres:16-alpine";
  const container = await new PostgreSqlContainer(image)
    .withDatabase(opts.database ?? "noddde_test")
    .withUsername("noddde")
    .withPassword("noddde")
    .start();

  return {
    container,
    url: container.getConnectionUri(),
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    username: container.getUsername(),
    password: container.getPassword(),
    stop: async () => {
      await container.stop({ remove: true, removeVolumes: true });
    },
  };
}
