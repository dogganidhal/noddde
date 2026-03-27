import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import { packageJsonTemplate } from "../../templates/project/package-json.js";
import { tsconfigTemplate } from "../../templates/project/tsconfig.js";
import { vitestConfigTemplate } from "../../templates/project/vitest-config.js";
import { gitignoreTemplate } from "../../templates/project/gitignore.js";
import { sampleTestTemplate } from "../../templates/project/sample-test.js";

const ctx = buildContext("HotelBooking");

describe("project templates", () => {
  describe("package.json", () => {
    it("generates valid JSON with core deps", () => {
      const result = packageJsonTemplate(ctx, "in-memory");
      const pkg = JSON.parse(result);
      expect(pkg.name).toBe("hotel-booking");
      expect(pkg.private).toBe(true);
      expect(pkg.dependencies["@noddde/core"]).toBeDefined();
      expect(pkg.dependencies["@noddde/engine"]).toBeDefined();
      expect(pkg.devDependencies["@noddde/testing"]).toBeDefined();
      expect(pkg.devDependencies["vitest"]).toBeDefined();
      expect(pkg.scripts.start).toContain("tsx");
      expect(pkg.scripts.test).toBe("vitest run");
    });

    it("adds prisma deps when adapter is prisma", () => {
      const pkg = JSON.parse(packageJsonTemplate(ctx, "prisma"));
      expect(pkg.dependencies["@noddde/prisma"]).toBeDefined();
      expect(pkg.dependencies["@prisma/client"]).toBeDefined();
      expect(pkg.devDependencies["prisma"]).toBeDefined();
    });

    it("adds drizzle deps when adapter is drizzle", () => {
      const pkg = JSON.parse(packageJsonTemplate(ctx, "drizzle"));
      expect(pkg.dependencies["@noddde/drizzle"]).toBeDefined();
      expect(pkg.dependencies["drizzle-orm"]).toBeDefined();
      expect(pkg.dependencies["better-sqlite3"]).toBeDefined();
      expect(pkg.devDependencies["@types/better-sqlite3"]).toBeDefined();
    });

    it("adds typeorm deps when adapter is typeorm", () => {
      const pkg = JSON.parse(packageJsonTemplate(ctx, "typeorm"));
      expect(pkg.dependencies["@noddde/typeorm"]).toBeDefined();
    });

    it("has no adapter deps for in-memory", () => {
      const pkg = JSON.parse(packageJsonTemplate(ctx, "in-memory"));
      expect(pkg.dependencies["@noddde/prisma"]).toBeUndefined();
      expect(pkg.dependencies["@noddde/drizzle"]).toBeUndefined();
      expect(pkg.dependencies["@noddde/typeorm"]).toBeUndefined();
    });
  });

  describe("tsconfig.json", () => {
    it("generates valid JSON extending noddde base", () => {
      const result = tsconfigTemplate();
      const config = JSON.parse(result);
      expect(config.extends).toBe("@noddde/typescript-config/base.json");
      expect(config.compilerOptions.outDir).toBe("dist");
      expect(config.include).toContain("src");
    });
  });

  describe("vitest.config.mts", () => {
    it("generates config with test include pattern", () => {
      const result = vitestConfigTemplate();
      expect(result).toContain("defineConfig");
      expect(result).toContain("src/__tests__/**/*.test.ts");
    });
  });

  describe(".gitignore", () => {
    it("ignores node_modules and dist", () => {
      const result = gitignoreTemplate();
      expect(result).toContain("node_modules/");
      expect(result).toContain("dist/");
      expect(result).toContain(".env");
    });
  });

  describe("sample test", () => {
    it("generates test using @noddde/testing", () => {
      const result = sampleTestTemplate(ctx);
      expect(result).toContain("testAggregate");
      expect(result).toContain("testDomain");
      expect(result).toContain("HotelBooking");
      expect(result).toContain("HotelBookingProjection");
      expect(result).toContain("@noddde/testing");
      expect(result).toContain("CreateHotelBooking");
    });
  });
});
