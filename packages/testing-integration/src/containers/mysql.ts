import {
  MySqlContainer,
  type StartedMySqlContainer,
} from "@testcontainers/mysql";

export interface StartedMysql {
  container: StartedMySqlContainer;
  url: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  rootPassword: string;
  stop: () => Promise<void>;
}

export async function startMysql(
  opts: {
    image?: string;
    database?: string;
  } = {},
): Promise<StartedMysql> {
  const image = opts.image ?? "mysql:8.0";
  const container = await new MySqlContainer(image)
    .withDatabase(opts.database ?? "noddde_test")
    .withRootPassword("root")
    .withUsername("noddde")
    .withUserPassword("noddde")
    .start();

  return {
    container,
    url: container.getConnectionUri(),
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    username: container.getUsername(),
    password: container.getUserPassword(),
    rootPassword: container.getRootPassword(),
    stop: async () => {
      await container.stop({ remove: true, removeVolumes: true });
    },
  };
}
