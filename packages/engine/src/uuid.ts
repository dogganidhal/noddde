import { randomBytes } from "node:crypto";

/**
 * Generates a UUID v7 string (RFC 9562).
 *
 * UUID v7 embeds a 48-bit Unix timestamp in milliseconds, producing
 * time-ordered identifiers ideal for event store indexing and
 * chronological sorting.
 *
 * Layout: `tttttttt-tttt-7xxx-yxxx-xxxxxxxxxxxx`
 * - `t`: 48-bit timestamp (ms since Unix epoch)
 * - `7`: version nibble
 * - `y`: variant bits (10xx)
 * - `x`: random bits
 */
export function uuidv7(): string {
  const now = Date.now();
  const bytes = randomBytes(16);

  // Bytes 0-5: 48-bit timestamp in ms (big-endian)
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Byte 6: version 7 (0111xxxx)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;

  // Byte 8: variant 10xxxxxx
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
