import { realpath } from "node:fs/promises";
import path from "node:path";
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
  const skipPathSafetyCheck = options?.skipPathSafetyCheck ?? false;

  if (!skipPathSafetyCheck && isUnsafePath(filePath)) {
    logger.warn("Model aliases file rejected due to unsafe path", {
      filePath,
      reason: "path contains '..' or is absolute",
    });
    return createAliasService(aliasMap);
  }

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

  if (!skipPathSafetyCheck) {
    const cwdRealpath = await resolveRealPath(process.cwd(), logger, "cwd");
    if (!cwdRealpath) {
      return createAliasService(aliasMap);
    }
    const resolvedPath = await resolveRealPath(
      filePath,
      logger,
      "model aliases file"
    );
    if (!resolvedPath) {
      return createAliasService(aliasMap);
    }
    if (!isPathWithinBase(resolvedPath, cwdRealpath)) {
      logger.warn("Model aliases file resolves outside cwd, ignoring", {
        filePath,
        resolvedPath,
        cwd: cwdRealpath,
      });
      return createAliasService(aliasMap);
    }
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

async function resolveRealPath(
  targetPath: string,
  logger: Logger,
  label: string
): Promise<string | null> {
  try {
    return await realpath(targetPath);
  } catch (error) {
    logger.warn(`Failed to resolve ${label} realpath`, {
      path: targetPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function isPathWithinBase(targetPath: string, basePath: string): boolean {
  if (targetPath === basePath) return true;
  const baseWithSep = basePath.endsWith(path.sep)
    ? basePath
    : `${basePath}${path.sep}`;
  return targetPath.startsWith(baseWithSep);
}

function isUnsafePath(filePath: string): boolean {
  if (filePath.startsWith("/") || /^[a-zA-Z]:\\/.test(filePath)) {
    return true;
  }
  if (filePath.includes("..")) {
    return true;
  }
  return false;
}
