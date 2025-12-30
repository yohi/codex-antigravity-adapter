import { z } from "zod";

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

const AliasTagSchema = z
  .string()
  .regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/, "Invalid alias tag format");
const TargetModelSchema = z.string().min(1, "Model ID must not be empty");

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
      if (isValidAliasEntry(alias, target, logger, filePath)) {
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

function isValidAliasEntry(
  alias: string,
  target: unknown,
  logger: Logger,
  filePath: string
): target is string {
  const aliasResult = AliasTagSchema.safeParse(alias);
  if (!aliasResult.success) {
    logger.warn("Invalid model alias entry, skipping", {
      filePath,
      alias,
      reason: "invalid alias tag format",
    });
    return false;
  }

  const targetResult = TargetModelSchema.safeParse(target);
  if (!targetResult.success) {
    logger.warn("Invalid model alias entry, skipping", {
      filePath,
      alias,
      reason: "invalid target model id",
    });
    return false;
  }

  return true;
}
