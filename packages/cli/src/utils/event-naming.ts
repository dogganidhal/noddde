import { input } from "@inquirer/prompts";
import { toPascalCase, toKebabCase } from "./naming.js";

/**
 * Splits a PascalCase string into individual words.
 * "PlaceBid" → ["Place", "Bid"], "CreateAuction" → ["Create", "Auction"]
 */
function splitPascal(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Converts a verb to its past tense form (simple heuristic).
 * - Ends in "e" → append "d" ("Place" → "Placed")
 * - Short CVC pattern → double final consonant + "ed" ("Submit" → "Submitted")
 * - Otherwise → append "ed" ("Open" → "Opened")
 */
function toPastTense(verb: string): string {
  const lower = verb.toLowerCase();
  if (lower.endsWith("e")) {
    return verb + "d";
  }
  // Double final consonant for short CVC-ending verbs (stop, submit, plan, etc.)
  const vowels = "aeiou";
  if (
    lower.length >= 3 &&
    !vowels.includes(lower[lower.length - 1]!) &&
    vowels.includes(lower[lower.length - 2]!) &&
    !vowels.includes(lower[lower.length - 3]!)
  ) {
    return verb + verb[verb.length - 1] + "ed";
  }
  return verb + "ed";
}

/**
 * Derives an event name from a command name using the convention:
 * verb + subject → subject + past-tense verb.
 *
 * "PlaceBid" → "BidPlaced"
 * "CreateAuction" → "AuctionCreated"
 * "CloseAuction" → "AuctionClosed"
 * "Submit" → "Submitted"
 */
export function deriveEventName(commandName: string): string {
  const words = splitPascal(toPascalCase(commandName));
  if (words.length === 0) return commandName;
  if (words.length === 1) {
    return toPascalCase(toPastTense(words[0]!));
  }
  const verb = words[0]!;
  const subject = words.slice(1).join("");
  return subject + toPastTense(verb);
}

/**
 * Derives a kebab-case event name from a PascalCase event name.
 */
export function eventKebab(eventName: string): string {
  return toKebabCase(eventName);
}

/**
 * Interactively confirms or overrides the derived event name.
 * Shows the auto-derived name as default and lets the user type a different one.
 */
export async function promptEventName(commandName: string): Promise<string> {
  const derived = deriveEventName(commandName);
  const result = await input({
    message: `Event name for "${commandName}"?`,
    default: derived,
  });
  return toPascalCase(result);
}
