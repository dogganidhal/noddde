import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  insertBeforeMarker,
  insertAfterLastMatch,
  appendToBarrel,
  insertImports,
  fileContains,
} from "../../utils/file-modifier.js";

describe("file-modifier utilities", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("insertBeforeMarker", () => {
    it("inserts content before a string marker", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(filePath, `line1\n  // TODO: add more\nline3\n`, "utf-8");

      const result = await insertBeforeMarker(
        filePath,
        "// TODO: add more",
        "  newLine;",
      );

      expect(result).toEqual({ inserted: true, usedFallback: false });
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("newLine;");
      expect(content.indexOf("newLine")).toBeLessThan(
        content.indexOf("// TODO"),
      );
    });

    it("preserves marker line indentation", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(filePath, `{\n    // TODO: marker\n}\n`, "utf-8");

      await insertBeforeMarker(filePath, "// TODO: marker", "inserted;");

      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("    inserted;");
    });

    it("returns not inserted when marker not found", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(filePath, `no marker here\n`, "utf-8");

      const result = await insertBeforeMarker(
        filePath,
        "// MISSING",
        "content",
      );

      expect(result).toEqual({ inserted: false, usedFallback: false });
    });

    it("uses fallback append when marker not found and option set", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(filePath, `existing content\n`, "utf-8");

      const result = await insertBeforeMarker(
        filePath,
        "// MISSING",
        "appended;",
        { fallbackAppend: true },
      );

      expect(result).toEqual({ inserted: true, usedFallback: true });
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("appended;");
    });
  });

  describe("insertAfterLastMatch", () => {
    it("inserts content after the last matching line", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(
        filePath,
        `  decide: {\n    Create: decideCreate,\n  },\n`,
        "utf-8",
      );

      const result = await insertAfterLastMatch(
        filePath,
        /^\s+\w+: decide\w+,$/,
        "    PlaceBid: decidePlaceBid,",
      );

      expect(result).toBe(true);
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("PlaceBid: decidePlaceBid,");
    });

    it("returns false when no match found", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(filePath, `no match here\n`, "utf-8");

      const result = await insertAfterLastMatch(
        filePath,
        /decide\w+/,
        "content",
      );

      expect(result).toBe(false);
    });
  });

  describe("appendToBarrel", () => {
    it("appends export line to barrel file", async () => {
      const filePath = path.join(tmpDir, "index.ts");
      await writeFile(
        filePath,
        `export { existing } from "./existing.js";\n`,
        "utf-8",
      );

      await appendToBarrel(
        filePath,
        `export { newThing } from "./new-thing.js";`,
      );

      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("existing");
      expect(content).toContain("newThing");
    });
  });

  describe("insertImports", () => {
    it("inserts import after last existing import", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(
        filePath,
        `import { a } from "./a.js";\nimport { b } from "./b.js";\n\nconst x = 1;\n`,
        "utf-8",
      );

      await insertImports(filePath, `import { c } from "./c.js";`);

      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const cIndex = lines.findIndex((l) => l.includes("./c.js"));
      const bIndex = lines.findIndex((l) => l.includes("./b.js"));
      expect(cIndex).toBeGreaterThan(bIndex);
    });

    it("prepends import when no existing imports", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(filePath, `const x = 1;\n`, "utf-8");

      await insertImports(filePath, `import { a } from "./a.js";`);

      const content = await readFile(filePath, "utf-8");
      expect(content.startsWith("import")).toBe(true);
    });
  });

  describe("fileContains", () => {
    it("returns true when string is found", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(filePath, `const x = "hello";\n`, "utf-8");

      expect(await fileContains(filePath, "hello")).toBe(true);
    });

    it("returns false when string is not found", async () => {
      const filePath = path.join(tmpDir, "test.ts");
      await writeFile(filePath, `const x = "hello";\n`, "utf-8");

      expect(await fileContains(filePath, "goodbye")).toBe(false);
    });
  });
});
