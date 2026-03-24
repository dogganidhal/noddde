/** Template for handlers/index.ts — re-exports all saga handlers. */
export function sagaHandlersIndexTemplate(): string {
  return `export { onStartEvent } from "./on-start-event.js";
`;
}
