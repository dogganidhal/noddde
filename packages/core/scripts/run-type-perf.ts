/**
 * Type-system perf harness.
 *
 * For each scale tier (default: 10 / 50 / 100 aggregates), generates a
 * synthetic fixture, runs `tsc --noEmit --extendedDiagnostics` against it,
 * parses the metrics, and writes a markdown report to
 * `specs/reports/type-perf.md`.
 *
 * Initial mode is report-only: the script always exits 0. Threshold
 * gating will be added in a follow-up once a baseline stabilises.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { generateStressFixture } from "./generate-stress-fixture";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const corePackageRoot = path.resolve(__dirname, "..");
const perfDir = path.join(corePackageRoot, ".type-perf");
const repoRoot = path.resolve(corePackageRoot, "..", "..");
const reportsDir = path.join(repoRoot, "specs", "reports");

interface Tier {
  aggregates: number;
  commandsPerAggregate?: number;
  projections?: number;
  sagas?: number;
}

interface ResolvedTier {
  aggregates: number;
  commandsPerAggregate: number;
  projections: number;
  sagas: number;
}

interface PerfMetric {
  tier: ResolvedTier;
  instantiations: number | null;
  memoryMb: number | null;
  totalTimeSec: number | null;
  exitCode: number;
  errorSnippet?: string;
}

const DEFAULT_TIERS: Tier[] = [
  { aggregates: 10 },
  { aggregates: 50 },
  { aggregates: 100 },
];

function parseTiers(argv: string[]): Tier[] {
  const flat = argv.flatMap((a) => a.split(",")).filter(Boolean);
  const nums = flat
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return DEFAULT_TIERS;
  return nums.map((n) => ({ aggregates: n }));
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writePerfTsconfig(): string {
  const tsconfigPath = path.join(perfDir, "tsconfig.perf.json");
  const tsconfig = {
    extends: "@noddde/typescript-config/base.json",
    compilerOptions: {
      noEmit: true,
      skipLibCheck: true,
      baseUrl: ".",
      paths: {
        "@noddde/core": ["../src/index.ts"],
      },
      module: "esnext",
      moduleResolution: "bundler",
    },
    include: ["fixture.ts"],
  };
  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
  return tsconfigPath;
}

function resolveTier(tier: Tier): ResolvedTier {
  return {
    aggregates: tier.aggregates,
    commandsPerAggregate: tier.commandsPerAggregate ?? 3,
    projections: tier.projections ?? Math.ceil(tier.aggregates / 3),
    sagas: tier.sagas ?? Math.ceil(tier.aggregates / 5),
  };
}

function parseExtendedDiagnostics(output: string): {
  instantiations: number | null;
  memoryMb: number | null;
  totalTimeSec: number | null;
} {
  const num = (m: RegExpMatchArray | null): number | null =>
    m ? Number(m[1]!.replace(/,/g, "")) : null;

  const instMatch = output.match(/Instantiations:\s+([\d,]+)/);
  const memMatch = output.match(/Memory used:\s+([\d,.]+)K/);
  const timeMatch = output.match(/Total time:\s+([\d.]+)s/);

  return {
    instantiations: num(instMatch),
    memoryMb: memMatch ? Number(memMatch[1]!.replace(/,/g, "")) / 1024 : null,
    totalTimeSec: num(timeMatch),
  };
}

function runOneTier(tier: Tier, tsconfigPath: string): PerfMetric {
  const resolved = resolveTier(tier);

  const fixture = generateStressFixture({
    aggregates: resolved.aggregates,
    commandsPerAggregate: resolved.commandsPerAggregate,
    projections: resolved.projections,
    sagas: resolved.sagas,
    coreImport: "@noddde/core",
  });
  fs.writeFileSync(path.join(perfDir, "fixture.ts"), fixture);

  // shell:true with a single command string avoids Node's DEP0190 warning
  // about combining args arrays with shell mode. Path comes from the
  // harness, not user input — no injection risk.
  const cmd = `npx tsc --noEmit --extendedDiagnostics --pretty false -p "${tsconfigPath}"`;
  const result = spawnSync(cmd, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    cwd: corePackageRoot,
    shell: true,
  });

  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  const parsed = parseExtendedDiagnostics(combined);
  const exitCode = result.status ?? -1;

  const metric: PerfMetric = {
    tier: resolved,
    ...parsed,
    exitCode,
  };

  if (exitCode !== 0) {
    const tail = combined.split("\n").slice(-20).join("\n");
    metric.errorSnippet = tail;
    process.stderr.write(
      `tsc failed for N=${resolved.aggregates} (exit ${exitCode}):\n${tail}\n`,
    );
  }

  return metric;
}

function getTscVersion(): string {
  const r = spawnSync("npx tsc --version", {
    encoding: "utf8",
    cwd: corePackageRoot,
    shell: true,
  });
  return ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").pop() ?? "";
}

function fmtNumber(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function fmtFloat(n: number | null, digits = 2): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

function writeReport(metrics: PerfMetric[]): string {
  const now = new Date().toISOString();
  const tscVersion = getTscVersion();

  const lines: string[] = [];
  lines.push(`# Type-system perf report — \`@noddde/core\``);
  lines.push(``);
  lines.push(
    `_Last run: ${now} · host: ${process.platform} ${process.arch} · node ${process.version} · ${tscVersion || "tsc version unknown"}_`,
  );
  lines.push(``);
  lines.push(
    `Generated by [\`packages/core/scripts/run-type-perf.ts\`](../../packages/core/scripts/run-type-perf.ts) against synthetic fixtures from [\`generate-stress-fixture.ts\`](../../packages/core/scripts/generate-stress-fixture.ts). The fixture composes N aggregates, M commands/events each, plus projections and sagas, then runs them through \`defineDomain\` — the same surface a real user touches.`,
  );
  lines.push(``);
  lines.push(
    `| N aggregates | Cmds/agg | Projections | Sagas | Instantiations | Memory (MB) | Total time (s) | Status |`,
  );
  lines.push(
    `| ------------ | -------- | ----------- | ----- | -------------- | ----------- | -------------- | ------ |`,
  );
  for (const m of metrics) {
    const status = m.exitCode === 0 ? "ok" : `exit ${m.exitCode}`;
    lines.push(
      `| ${m.tier.aggregates} | ${m.tier.commandsPerAggregate} | ${m.tier.projections} | ${m.tier.sagas} | ${fmtNumber(m.instantiations)} | ${fmtFloat(m.memoryMb)} | ${fmtFloat(m.totalTimeSec)} | ${status} |`,
    );
  }
  lines.push(``);
  lines.push(`## Notes`);
  lines.push(``);
  lines.push(
    `Report-only: the harness always exits 0. A follow-up will add thresholds once 2–3 main-branch runs establish a baseline. IDE perf (tsserver responsiveness) is not measured here — open the largest fixture in VSCode for manual smoke verification.`,
  );
  lines.push(``);

  for (const m of metrics) {
    if (m.errorSnippet) {
      lines.push(`### tsc failure tail — N=${m.tier.aggregates}`);
      lines.push(``);
      lines.push("```");
      lines.push(m.errorSnippet);
      lines.push("```");
      lines.push(``);
    }
  }

  const reportPath = path.join(reportsDir, "type-perf.md");
  fs.writeFileSync(reportPath, lines.join("\n"));

  // Normalize through prettier so the committed report stays stable across
  // runs and the repo's `format:check` step doesn't trip on it.
  const fmt = spawnSync(`npx prettier --write "${reportPath}"`, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (fmt.status !== 0) {
    process.stderr.write(
      `prettier formatting of ${reportPath} failed (exit ${fmt.status}):\n${(fmt.stdout ?? "") + (fmt.stderr ?? "")}\n`,
    );
  }

  return reportPath;
}

function main(): void {
  ensureDir(perfDir);
  ensureDir(reportsDir);

  const tiers = parseTiers(process.argv.slice(2));
  const tsconfigPath = writePerfTsconfig();

  const metrics: PerfMetric[] = [];
  for (const tier of tiers) {
    const m = runOneTier(tier, tsconfigPath);
    metrics.push(m);
    process.stdout.write(
      `N=${m.tier.aggregates}: instantiations=${fmtNumber(m.instantiations)}, memory=${fmtFloat(m.memoryMb)}MB, time=${fmtFloat(m.totalTimeSec)}s${m.exitCode === 0 ? "" : ` (exit ${m.exitCode})`}\n`,
    );
  }

  const reportPath = writeReport(metrics);
  process.stdout.write(`Report written to ${reportPath}\n`);
}

main();
