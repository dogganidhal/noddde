import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadDomain } from "../diagram/load-domain.js";
import { buildDomainGraph } from "../diagram/build-graph.js";
import { emitMermaid } from "../diagram/emit-mermaid.js";
import { emitDot } from "../diagram/emit-dot.js";
import { emitJson } from "../diagram/emit-json.js";
import type {
  DiagramFormat,
  DiagramScope,
  DomainGraph,
} from "../diagram/types.js";

interface DiagramCliOptions {
  out?: string;
  format?: string;
  scope?: string;
  hideIsolated?: boolean;
  tsconfig?: string;
}

const VALID_FORMATS: DiagramFormat[] = ["mermaid", "dot", "json"];
const VALID_SCOPES: DiagramScope[] = ["write", "read", "process", "all"];

/**
 * Registers the `noddde diagram` subcommand.
 *
 * Usage:
 *   noddde diagram [domain-file]
 *     --out <path>
 *     --format <mermaid|dot|json>
 *     --scope  <write|read|process|all>
 *     --hide-isolated
 *     --tsconfig <path>
 */
export function registerDiagramCommand(program: Command): void {
  program
    .command("diagram [domain-file]")
    .alias("d")
    .description(
      "Generate a flow diagram (commands → events → projections / sagas → queries) from a noddde domain.",
    )
    .option("--out <path>", "Write the diagram to a file. Defaults to stdout.")
    .option(
      "--format <format>",
      `Output format: ${VALID_FORMATS.join(" | ")}. Default: mermaid.`,
      "mermaid",
    )
    .option(
      "--scope <scope>",
      `Subgraphs to include: ${VALID_SCOPES.join(" | ")}. Default: all.`,
      "all",
    )
    .option(
      "--hide-isolated",
      "Drop nodes with degree 0 after scope filtering.",
      false,
    )
    .option(
      "--tsconfig <path>",
      "Path to a tsconfig.json used for the saga static-analysis pass. Auto-discovered when omitted.",
    )
    .action(async (domainFile: string | undefined, opts: DiagramCliOptions) => {
      const entry = resolveEntry(domainFile);
      const format = parseFormat(opts.format);
      const scope = parseScope(opts.scope);

      try {
        const { definition, entryFile } = await loadDomain(entry);
        const graph = buildDomainGraph(definition, entryFile, {
          format,
          scope,
          hideIsolated: !!opts.hideIsolated,
          tsconfigPath: opts.tsconfig,
        });

        const output = render(graph, format);

        if (opts.out) {
          fs.writeFileSync(path.resolve(opts.out), output, "utf8");
          process.stdout.write(
            `Diagram written to ${path.resolve(opts.out)}\n`,
          );
        } else {
          process.stdout.write(output);
          if (!output.endsWith("\n")) process.stdout.write("\n");
        }

        if (graph.warnings.length > 0) {
          process.stderr.write("\nDiagram warnings:\n");
          for (const w of graph.warnings) process.stderr.write(`  - ${w}\n`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`${message}\n`);
        process.exit(1);
      }
    });
}

function render(graph: DomainGraph, format: DiagramFormat): string {
  switch (format) {
    case "mermaid":
      return emitMermaid(graph);
    case "dot":
      return emitDot(graph);
    case "json":
      return emitJson(graph);
  }
}

function resolveEntry(provided: string | undefined): string {
  if (provided) return provided;
  return path.join(process.cwd(), "src", "domain", "domain.ts");
}

function parseFormat(value: string | undefined): DiagramFormat {
  if (!value) return "mermaid";
  if (!VALID_FORMATS.includes(value as DiagramFormat)) {
    throw new Error(
      `Invalid --format: '${value}'. Expected one of: ${VALID_FORMATS.join(", ")}.`,
    );
  }
  return value as DiagramFormat;
}

function parseScope(value: string | undefined): DiagramScope {
  if (!value) return "all";
  if (!VALID_SCOPES.includes(value as DiagramScope)) {
    throw new Error(
      `Invalid --scope: '${value}'. Expected one of: ${VALID_SCOPES.join(", ")}.`,
    );
  }
  return value as DiagramScope;
}
