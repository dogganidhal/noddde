import { Infrastructure } from "@veliche/core";

export interface DemoRepository {
  save: (id: string, state: any) => Promise<void>;
  load: (id: string) => Promise<any>;
}

export interface DemoInfrastructure extends Infrastructure {
  cartRepository: DemoRepository;
}
