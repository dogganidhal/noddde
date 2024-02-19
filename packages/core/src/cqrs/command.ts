export interface TargetedCommand {
  targetAggregateId: string;
}

export interface HeadlessCommand {}

export type Command = TargetedCommand | HeadlessCommand;
