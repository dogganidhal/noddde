import {
  MSSQLServerContainer,
  type StartedMSSQLServerContainer,
} from "@testcontainers/mssqlserver";

export interface StartedMssql {
  container: StartedMSSQLServerContainer;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  stop: () => Promise<void>;
}

/**
 * Starts SQL Server 2022 Developer Edition for TypeORM MSSQL coverage.
 * MSSQL boot is notoriously slow; budget ~60s. Tests wrap this in a
 * higher per-suite timeout.
 */
export async function startMssql(
  opts: { image?: string } = {},
): Promise<StartedMssql> {
  const image = opts.image ?? "mcr.microsoft.com/mssql/server:2022-latest";
  const container = await new MSSQLServerContainer(image)
    .acceptLicense()
    .withPassword("Noddde_Test_1234")
    .start();

  return {
    container,
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    stop: async () => {
      await container.stop({ remove: true, removeVolumes: true });
    },
  };
}
