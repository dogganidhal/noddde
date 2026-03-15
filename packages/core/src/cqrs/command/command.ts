export interface Command {
  name: string;
  payload?: any;
}

export interface AggregateCommand<TID = string> extends Command {
  targetAggregateId: TID;
}

export type StandaloneCommand = Command;

// Builds a command union from a payload map.
// Use `void` for commands with no payload.
//
//   type MyCommands = DefineCommands<{
//     CreateThing: void;
//     UpdateThing: { value: number };
//   }>;
//
export type DefineCommands<
  TPayloads extends Record<string, any>,
  TID = string,
> = {
  [K in keyof TPayloads & string]: TPayloads[K] extends void
    ? { name: K; targetAggregateId: TID }
    : { name: K; targetAggregateId: TID; payload: TPayloads[K] };
}[keyof TPayloads & string];
