import type { DomainGraph } from "./types.js";

/** Emits the canonical JSON serialization of a `DomainGraph`. */
export function emitJson(graph: DomainGraph): string {
  return JSON.stringify(graph, null, 2);
}
