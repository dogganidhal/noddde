export interface Event {
  name: string;
  payload: any;
}

// Builds an event union from a payload map.
//
//   type MyEvents = DefineEvents<{
//     ThingCreated: { id: string };
//     ThingUpdated: { id: string; value: number };
//   }>;
//
export type DefineEvents<TPayloads extends Record<string, any>> = {
  [K in keyof TPayloads & string]: { name: K; payload: TPayloads[K] };
}[keyof TPayloads & string];
