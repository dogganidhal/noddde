import * as path from "node:path";
import * as fs from "node:fs";
import * as ts from "typescript";

export interface SagaCommandAnalysis {
  /** Map of `<sagaKey>` → list of dispatched command names. */
  commands: Map<string, string[]>;
  /** Sagas whose `commands` type could not be resolved to a finite union. */
  unresolved: string[];
  /** Diagnostic messages (e.g. tsconfig not found). */
  warnings: string[];
}

/**
 * Resolves each saga's dispatched command names by reading the `commands`
 * field of its `SagaTypes` bundle via the TypeScript compiler API.
 *
 * The `entryFile` should be the user's domain entry (e.g. `src/domain/domain.ts`)
 * which exports a `sagas` object literal. For each `sagaKey` provided, the
 * analyzer locates the export, reads its declared type as `Saga<T>`, extracts
 * `T`, reads `T["commands"]`, and collects the `name` literal of each
 * discriminated-union member.
 */
export function analyzeSagaCommands(
  entryFile: string,
  sagaKeys: string[],
  tsconfigPath?: string,
): SagaCommandAnalysis {
  const result: SagaCommandAnalysis = {
    commands: new Map(),
    unresolved: [],
    warnings: [],
  };

  if (sagaKeys.length === 0) return result;

  const resolvedTsconfig = tsconfigPath ?? findNearestTsconfig(entryFile);
  if (!resolvedTsconfig) {
    result.warnings.push(
      "No tsconfig.json found near the domain entry; saga command edges will be omitted.",
    );
    for (const key of sagaKeys) result.unresolved.push(key);
    return result;
  }

  const program = createProgram(resolvedTsconfig, entryFile);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(path.resolve(entryFile));
  if (!sourceFile) {
    result.warnings.push(
      `Could not load source file ${entryFile} into the TypeScript program.`,
    );
    for (const key of sagaKeys) result.unresolved.push(key);
    return result;
  }

  const sagasSymbol = findExportedSymbol(sourceFile, checker, "sagas");
  if (!sagasSymbol) {
    result.warnings.push(
      `Entry file does not export a 'sagas' object literal; saga command edges will be omitted.`,
    );
    for (const key of sagaKeys) result.unresolved.push(key);
    return result;
  }

  const sagasType = checker.getTypeOfSymbolAtLocation(sagasSymbol, sourceFile);

  for (const sagaKey of sagaKeys) {
    const sagaProperty = sagasType.getProperty(sagaKey);
    if (!sagaProperty) {
      result.unresolved.push(sagaKey);
      result.warnings.push(
        `Saga '${sagaKey}' not found on the 'sagas' export; static analysis skipped.`,
      );
      continue;
    }

    const sagaPropertyType = checker.getTypeOfSymbolAtLocation(
      sagaProperty,
      sourceFile,
    );
    const commandNames = extractSagaCommands(checker, sagaPropertyType);

    if (commandNames === null) {
      result.unresolved.push(sagaKey);
      result.warnings.push(
        `Saga '${sagaKey}' declares an unconstrained command type; no Saga→Command edges produced.`,
      );
    } else {
      result.commands.set(sagaKey, commandNames);
    }
  }

  return result;
}

function findNearestTsconfig(start: string): string | undefined {
  let dir = path.dirname(path.resolve(start));
  const root = path.parse(dir).root;
  for (;;) {
    const candidate = path.join(dir, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
    dir = path.dirname(dir);
  }
}

function createProgram(tsconfigPath: string, entryFile: string): ts.Program {
  const configText = fs.readFileSync(tsconfigPath, "utf8");
  const parsed = ts.parseConfigFileTextToJson(tsconfigPath, configText);
  const tsconfigDir = path.dirname(tsconfigPath);

  const config = ts.parseJsonConfigFileContent(
    parsed.config ?? {},
    ts.sys,
    tsconfigDir,
  );

  const rootNames = Array.from(
    new Set([...config.fileNames, path.resolve(entryFile)]),
  );

  return ts.createProgram({
    rootNames,
    options: config.options,
  });
}

function findExportedSymbol(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  exportName: string,
): ts.Symbol | undefined {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return undefined;
  const exports = checker.getExportsOfModule(moduleSymbol);
  return exports.find((sym) => sym.getName() === exportName);
}

/**
 * Given the type of one entry on the `sagas` map (a `Saga<T>` instance),
 * pull out `T["commands"]` and collect the `name` literal of each
 * discriminated-union member.
 *
 * Returns `null` if the commands type is not a finite, name-discriminated
 * union (i.e. unresolvable).
 */
function extractSagaCommands(
  checker: ts.TypeChecker,
  sagaType: ts.Type,
): string[] | null {
  // The saga value is `Saga<T>`. Extract T.
  const sagaDef = extractSagaTypeArgument(sagaType);
  if (!sagaDef) return null;

  const commandsSymbol = sagaDef.getProperty("commands");
  if (!commandsSymbol) return null;
  const commandsDecl =
    commandsSymbol.valueDeclaration ?? commandsSymbol.declarations?.[0];
  if (!commandsDecl) return null;
  const commandsType = checker.getTypeOfSymbolAtLocation(
    commandsSymbol,
    commandsDecl,
  );

  return collectNameLiterals(checker, commandsType);
}

function extractSagaTypeArgument(sagaType: ts.Type): ts.Type | undefined {
  // `Saga<T>` is a TypeReference; its type arguments contain T.
  const typeReference = sagaType as ts.TypeReference;
  if (typeReference.typeArguments && typeReference.typeArguments.length > 0) {
    return typeReference.typeArguments[0];
  }

  // Sometimes the type comes back as `Saga<T> & { ... }` (intersection) when
  // multiple `as const` narrowings happen. Walk intersections.
  if (sagaType.isIntersection()) {
    for (const member of sagaType.types) {
      const inner = extractSagaTypeArgument(member);
      if (inner) return inner;
    }
  }

  return undefined;
}

function collectNameLiterals(
  checker: ts.TypeChecker,
  unionLike: ts.Type,
): string[] | null {
  const members = unionLike.isUnion() ? unionLike.types : [unionLike];
  const names: string[] = [];

  for (const member of members) {
    const nameSymbol = member.getProperty("name");
    if (!nameSymbol) return null;
    const nameDecl =
      nameSymbol.valueDeclaration ?? nameSymbol.declarations?.[0];
    if (!nameDecl) return null;
    const nameType = checker.getTypeOfSymbolAtLocation(nameSymbol, nameDecl);

    if (nameType.isStringLiteral()) {
      names.push(nameType.value);
      continue;
    }

    // Could be a union of literals if the member is itself a union.
    if (nameType.isUnion()) {
      const all = nameType.types.every((t) => t.isStringLiteral());
      if (!all) return null;
      for (const sub of nameType.types) {
        if (sub.isStringLiteral()) names.push(sub.value);
      }
      continue;
    }

    return null;
  }

  return Array.from(new Set(names));
}
