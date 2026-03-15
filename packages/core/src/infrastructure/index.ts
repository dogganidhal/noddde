import { CommandBus, QueryBus } from "../cqrs";
import { EventBus } from "../edd";

export type Infrastructure = {};

export interface CQRSInfrastructure {
  commandBus: CommandBus;
  eventBus: EventBus;
  queryBus: QueryBus;
}
