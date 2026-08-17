import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageJsonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../package.json",
);
const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

describe("@noddde/nestjs package shape", () => {
  it("declares rxjs and reflect-metadata as peers, not regular dependencies", () => {
    expect(pkg.dependencies).not.toHaveProperty("rxjs");
    expect(pkg.dependencies).not.toHaveProperty("reflect-metadata");
    expect(pkg.peerDependencies).toHaveProperty("rxjs");
    expect(pkg.peerDependencies).toHaveProperty("reflect-metadata");
  });

  it("does not depend on the unused @noddde/core package at runtime", () => {
    expect(pkg.dependencies).not.toHaveProperty("@noddde/core");
  });

  it("depends on @noddde/engine via a range, not an exact pin", () => {
    expect(pkg.dependencies["@noddde/engine"]).toMatch(/^[\^~]/);
  });
});
