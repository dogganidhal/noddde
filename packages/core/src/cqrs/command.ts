export interface TargetedCommand {
  targetAggregateId: string;
}

export interface CreationCommand {}

export type Command = TargetedCommand | CreationCommand;

export const isTargetedCommand = (
  command: Command,
): command is TargetedCommand => "targetAggregateId" in command;

export const isCreationCommand = (
  command: Command,
): command is CreationCommand => !("targetAggregateId" in command);
