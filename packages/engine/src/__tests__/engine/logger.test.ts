import { describe, it, expect, vi, afterEach } from "vitest";
import { ConsoleLogger, StructuredLogger, NoopLogger } from "@noddde/engine";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConsoleLogger level filtering", () => {
  it("should suppress debug and info at warn level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = new ConsoleLogger("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should emit all levels at debug level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = new ConsoleLogger("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should emit nothing at silent level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = new ConsoleLogger("silent");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("ConsoleLogger namespace prefixing", () => {
  it("should prefix messages with [noddde] by default", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = new ConsoleLogger("warn");
    logger.warn("test message");

    expect(warnSpy).toHaveBeenCalledWith("[noddde]", "test message");
  });

  it("should prefix with custom namespace", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = new ConsoleLogger("warn", "myapp");
    logger.warn("test message");

    expect(warnSpy).toHaveBeenCalledWith("[myapp]", "test message");
  });
});

describe("ConsoleLogger structured data", () => {
  it("should pass data as additional argument when non-empty", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = new ConsoleLogger("info");
    logger.info("loaded", { aggregateId: "123", version: 5 });

    expect(infoSpy).toHaveBeenCalledWith("[noddde]", "loaded", {
      aggregateId: "123",
      version: 5,
    });
  });

  it("should not pass empty data object", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = new ConsoleLogger("info");
    logger.info("loaded", {});

    expect(infoSpy).toHaveBeenCalledWith("[noddde]", "loaded");
  });

  it("should not pass data when omitted", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = new ConsoleLogger("info");
    logger.info("loaded");

    expect(infoSpy).toHaveBeenCalledWith("[noddde]", "loaded");
  });
});

describe("ConsoleLogger.child", () => {
  it("should create child with composed namespace", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const root = new ConsoleLogger("info");
    const child = root.child("command");
    child.info("dispatching");

    expect(infoSpy).toHaveBeenCalledWith("[noddde:command]", "dispatching");
  });

  it("should support deeply nested children", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const logger = new ConsoleLogger("debug")
      .child("command")
      .child("lifecycle");
    logger.debug("step");

    expect(debugSpy).toHaveBeenCalledWith("[noddde:command:lifecycle]", "step");
  });

  it("should inherit parent level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const child = new ConsoleLogger("warn").child("saga");
    child.debug("should not appear");
    child.warn("should appear");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[noddde:saga]", "should appear");
  });

  it("should return a new instance (not the same reference)", () => {
    const logger = new ConsoleLogger("info");
    const child = logger.child("test");
    expect(child).not.toBe(logger);
  });
});

describe("NoopLogger", () => {
  it("should not call any console methods", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = new NoopLogger();
    logger.debug("d", { key: "value" });
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("NoopLogger.child", () => {
  it("should return the same NoopLogger instance", () => {
    const logger = new NoopLogger();
    const child = logger.child("anything");
    expect(child).toBe(logger);
  });

  it("should return same instance for nested children", () => {
    const logger = new NoopLogger();
    const nested = logger.child("a").child("b").child("c");
    expect(nested).toBe(logger);
  });
});

describe("ConsoleLogger defaults", () => {
  it("should default to warn level and noddde namespace", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = new ConsoleLogger();
    logger.debug("should not appear");
    logger.warn("should appear");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[noddde]", "should appear");
  });
});

describe("StructuredLogger level filtering", () => {
  it("should suppress debug and info at warn level", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const logger = new StructuredLogger("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("should emit all levels at debug level", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const logger = new StructuredLogger("debug");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(stdoutSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("should emit nothing at silent level", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const logger = new StructuredLogger("silent");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("StructuredLogger JSON output", () => {
  it("should write NDJSON with timestamp, level, namespace, and message", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const logger = new StructuredLogger("info");
    logger.info("test message");

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const line = stdoutSpy.mock.calls[0]![0] as string;
    expect(line.endsWith("\n")).toBe(true);

    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: "info",
      namespace: "noddde",
      message: "test message",
    });
    expect(parsed.timestamp).toBeDefined();
    expect(() => new Date(parsed.timestamp)).not.toThrow();
  });

  it("should include structured data as top-level fields", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const logger = new StructuredLogger("info");
    logger.info("loaded", { aggregateId: "123", version: 5 });

    const parsed = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
    expect(parsed).toMatchObject({
      level: "info",
      namespace: "noddde",
      message: "loaded",
      aggregateId: "123",
      version: 5,
    });
  });

  it("should not include data fields when data is empty", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const logger = new StructuredLogger("info");
    logger.info("loaded", {});

    const parsed = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
    expect(Object.keys(parsed)).toEqual([
      "timestamp",
      "level",
      "namespace",
      "message",
    ]);
  });

  it("should write warn and error to stderr", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const logger = new StructuredLogger("warn");
    logger.warn("warning");
    logger.error("failure");

    expect(stderrSpy).toHaveBeenCalledTimes(2);

    const warnParsed = JSON.parse(stderrSpy.mock.calls[0]![0] as string);
    expect(warnParsed.level).toBe("warn");

    const errorParsed = JSON.parse(stderrSpy.mock.calls[1]![0] as string);
    expect(errorParsed.level).toBe("error");
  });
});

describe("StructuredLogger.child", () => {
  it("should create child with composed namespace", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const root = new StructuredLogger("info");
    const child = root.child("command");
    child.info("dispatching");

    const parsed = JSON.parse(stdoutSpy.mock.calls[0]![0] as string);
    expect(parsed.namespace).toBe("noddde:command");
  });

  it("should inherit parent level", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const child = new StructuredLogger("warn").child("saga");
    child.debug("should not appear");
    child.warn("should appear");

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    const parsed = JSON.parse(stderrSpy.mock.calls[0]![0] as string);
    expect(parsed.namespace).toBe("noddde:saga");
  });

  it("should return a new instance (not the same reference)", () => {
    const logger = new StructuredLogger("info");
    const child = logger.child("test");
    expect(child).not.toBe(logger);
  });
});
