import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateProject } from "../../generators/project.js";

describe("generateProject", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates project config files", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory");

    const base = path.join(tmpDir, "hotel-booking");
    const configFiles = [
      "package.json",
      "tsconfig.json",
      "vitest.config.mts",
      ".gitignore",
    ];

    for (const file of configFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("creates domain scaffold under src/", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory");

    const base = path.join(tmpDir, "hotel-booking");
    const domainFiles = [
      "src/main.ts",
      "src/infrastructure/index.ts",
      "src/domain/domain.ts",
      "src/domain/event-model/index.ts",
      "src/domain/write-model/index.ts",
      "src/domain/write-model/aggregates/hotel-booking/hotel-booking.ts",
      "src/domain/read-model/projections/hotel-booking/hotel-booking.ts",
    ];

    for (const file of domainFiles) {
      await expect(access(path.join(base, file))).resolves.toBeUndefined();
    }
  });

  it("creates sample test file", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory");

    const testPath = path.join(
      tmpDir,
      "hotel-booking/src/__tests__/hotel-booking.test.ts",
    );
    const content = await readFile(testPath, "utf-8");
    expect(content).toContain("testAggregate");
    expect(content).toContain("testDomain");
    expect(content).toContain("HotelBooking");
    expect(content).toContain("@noddde/testing");
  });

  it("generates in-memory package.json without adapter deps", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory");

    const pkg = JSON.parse(
      await readFile(path.join(tmpDir, "hotel-booking/package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@noddde/core"]).toBeDefined();
    expect(pkg.dependencies["@noddde/engine"]).toBeDefined();
    expect(pkg.dependencies["@noddde/prisma"]).toBeUndefined();
    expect(pkg.dependencies["@noddde/drizzle"]).toBeUndefined();
  });

  it("generates prisma package.json with adapter deps", async () => {
    await generateProject("HotelBooking", tmpDir, "prisma");

    const pkg = JSON.parse(
      await readFile(path.join(tmpDir, "hotel-booking/package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@noddde/prisma"]).toBeDefined();
    expect(pkg.dependencies["@prisma/client"]).toBeDefined();
    expect(pkg.devDependencies["prisma"]).toBeDefined();
  });

  it("generates drizzle package.json with adapter deps", async () => {
    await generateProject("HotelBooking", tmpDir, "drizzle");

    const pkg = JSON.parse(
      await readFile(path.join(tmpDir, "hotel-booking/package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@noddde/drizzle"]).toBeDefined();
    expect(pkg.dependencies["drizzle-orm"]).toBeDefined();
    expect(pkg.dependencies["better-sqlite3"]).toBeDefined();
  });

  it("generates typeorm package.json with adapter deps", async () => {
    await generateProject("HotelBooking", tmpDir, "typeorm");

    const pkg = JSON.parse(
      await readFile(path.join(tmpDir, "hotel-booking/package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@noddde/typeorm"]).toBeDefined();
  });

  it("generates kafka event bus package.json with adapter deps", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory", "kafka");

    const pkg = JSON.parse(
      await readFile(path.join(tmpDir, "hotel-booking/package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@noddde/kafka"]).toBeDefined();
    expect(pkg.dependencies["kafkajs"]).toBeDefined();
  });

  it("generates nats event bus package.json with adapter deps", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory", "nats");

    const pkg = JSON.parse(
      await readFile(path.join(tmpDir, "hotel-booking/package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@noddde/nats"]).toBeDefined();
    expect(pkg.dependencies["nats"]).toBeDefined();
  });

  it("generates rabbitmq event bus package.json with adapter deps", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory", "rabbitmq");

    const pkg = JSON.parse(
      await readFile(path.join(tmpDir, "hotel-booking/package.json"), "utf-8"),
    );
    expect(pkg.dependencies["@noddde/rabbitmq"]).toBeDefined();
    expect(pkg.dependencies["amqplib"]).toBeDefined();
    expect(pkg.devDependencies["@types/amqplib"]).toBeDefined();
  });

  it("generates kafka main.ts with KafkaEventBus wiring", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory", "kafka");

    const mainTs = await readFile(
      path.join(tmpDir, "hotel-booking/src/main.ts"),
      "utf-8",
    );
    expect(mainTs).toContain("KafkaEventBus");
    expect(mainTs).toContain("@noddde/kafka");
    expect(mainTs).not.toContain("eventBus.connect()");
    expect(mainTs).not.toContain("EventEmitterEventBus");
  });

  it("generates nats main.ts with NatsEventBus wiring", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory", "nats");

    const mainTs = await readFile(
      path.join(tmpDir, "hotel-booking/src/main.ts"),
      "utf-8",
    );
    expect(mainTs).toContain("NatsEventBus");
    expect(mainTs).toContain("@noddde/nats");
    expect(mainTs).not.toContain("eventBus.connect()");
    expect(mainTs).not.toContain("EventEmitterEventBus");
  });

  it("generates rabbitmq main.ts with RabbitMqEventBus wiring", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory", "rabbitmq");

    const mainTs = await readFile(
      path.join(tmpDir, "hotel-booking/src/main.ts"),
      "utf-8",
    );
    expect(mainTs).toContain("RabbitMqEventBus");
    expect(mainTs).toContain("@noddde/rabbitmq");
    expect(mainTs).not.toContain("eventBus.connect()");
    expect(mainTs).not.toContain("EventEmitterEventBus");
  });

  it("generates event-emitter main.ts with EventEmitterEventBus by default", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory");

    const mainTs = await readFile(
      path.join(tmpDir, "hotel-booking/src/main.ts"),
      "utf-8",
    );
    expect(mainTs).toContain("EventEmitterEventBus");
    expect(mainTs).not.toContain("KafkaEventBus");
    expect(mainTs).not.toContain("NatsEventBus");
    expect(mainTs).not.toContain("RabbitMqEventBus");
  });

  it("does not overwrite existing files", async () => {
    await generateProject("HotelBooking", tmpDir, "in-memory");

    const pkgPath = path.join(tmpDir, "hotel-booking/package.json");
    const originalContent = await readFile(pkgPath, "utf-8");

    await generateProject("HotelBooking", tmpDir, "in-memory");

    const afterContent = await readFile(pkgPath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("rejects invalid names", async () => {
    await expect(
      generateProject("123Invalid", tmpDir, "in-memory"),
    ).rejects.toThrow("Invalid name");
  });
});
