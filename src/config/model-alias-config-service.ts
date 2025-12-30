import type { Logger } from "../logging";
import { NOOP_LOGGER } from "../logging";

export type AliasMap = ReadonlyMap<string, string>;

export type ModelAliasConfigService = {
  getTargetModel: (alias: string) => string | undefined;
  hasAlias: (alias: string) => boolean;
  listAliases: () => readonly string[];
  getAll: () => AliasMap;
};

export type LoadAliasesOptions = {
  filePath?: string;
  logger?: Logger;
  /** Test-only: skip path safety checks. */
  skipPathSafetyCheck?: boolean;
};

export type ModelAliasConfigServiceFactory = {
  loadAliases: (options?: LoadAliasesOptions) => Promise<ModelAliasConfigService>;
};

export function createModelAliasConfigService(): ModelAliasConfigServiceFactory {
  return {
    loadAliases: (options) => loadAliases(options),
  };
}

async function loadAliases(
  options?: LoadAliasesOptions
): Promise<ModelAliasConfigService> {
  const aliasMap = new Map<string, string>();
  const filePath = options?.filePath ?? "model-aliases.json";
  const logger = options?.logger ?? NOOP_LOGGER;

  let exists = false;
  try {
    exists = await Bun.file(filePath).exists();
  } catch (error) {
    logger.warn("Failed to check model aliases file", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return createAliasService(aliasMap);
  }

  if (!exists) {
    logger.info("Model aliases file not found, continuing with empty map", {
      filePath,
    });
    return createAliasService(aliasMap);
  }

  let contents: string;
  try {
    contents = await Bun.file(filePath).text();
  } catch (error) {
    logger.warn("Failed to read model aliases file", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return createAliasService(aliasMap);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    logger.warn("Failed to parse model aliases file", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return createAliasService(aliasMap);
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [alias, target] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (typeof target === "string") {
        aliasMap.set(alias, target);
      }
    }
  }
  return createAliasService(aliasMap);
}

function createAliasService(
  aliasMap: Map<string, string>
): ModelAliasConfigService {
  const readonlyMap: AliasMap = aliasMap;
  return {
    getTargetModel: (alias) => readonlyMap.get(alias),
    hasAlias: (alias) => readonlyMap.has(alias),
    listAliases: () => Array.from(readonlyMap.keys()),
    getAll: () => readonlyMap,
  };
}
