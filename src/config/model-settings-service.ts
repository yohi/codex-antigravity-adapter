import { realpath } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../logging";
import { NOOP_LOGGER } from "../logging";

export type AvailableModel = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
};

export type ModelSourceCounts = {
  fixed: number;
  file: number;
  env: number;
};

export type ModelCatalog = {
  models: readonly AvailableModel[];
  sources: ModelSourceCounts;
};

export type ModelSettingsOptions = {
  fixedModelIds?: readonly string[];
  customModelPaths?: readonly string[];
  envVar?: string;
  now?: () => number;
  logger?: Logger;
  /** テスト用: パスの安全性チェックをスキップする */
  skipPathSafetyCheck?: boolean;
};

export type ModelSettingsService = {
  load: (options?: ModelSettingsOptions) => Promise<ModelCatalog>;
};

const DEFAULT_ENV_VAR = "ANTIGRAVITY_ADDITIONAL_MODELS";
export const DEFAULT_FIXED_MODEL_IDS = [
  "gemini-3-pro-high",
  "gemini-3-pro-low",
  "gemini-3-flash",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-thinking",
  "claude-opus-4-5-thinking",
  "gpt-oss-120b-medium",
];
const DEFAULT_CUSTOM_MODEL_PATHS = [
  "./custom-models.json",
  ".codex/custom-models.json",
];

export function createModelSettingsService(): ModelSettingsService {
  return {
    load: (options) => loadModelSettings(options),
  };
}

async function loadModelSettings(
  options: ModelSettingsOptions = {}
): Promise<ModelCatalog> {
  const fixedModelIds = options.fixedModelIds ?? DEFAULT_FIXED_MODEL_IDS;
  const envVar = options.envVar ?? DEFAULT_ENV_VAR;
  const now = options.now ?? (() => Date.now());
  const logger = options.logger ?? NOOP_LOGGER;
  const skipPathSafetyCheck = options.skipPathSafetyCheck ?? false;
  const customModelPaths =
    options.customModelPaths ?? DEFAULT_CUSTOM_MODEL_PATHS;

  const envModels = parseEnvModels(process.env[envVar], logger);
  const fileModels = await readFileModels(
    customModelPaths,
    logger,
    skipPathSafetyCheck
  );
  const created = Math.floor(now() / 1000);

  const sources: ModelSourceCounts = {
    env: envModels.length,
    file: fileModels.length,
    fixed: fixedModelIds.length,
  };

  // 重複排除: first-seen-wins（env → file → fixed の優先順位）
  const seen = new Set<string>();
  const models: AvailableModel[] = [];

  // env, file, fixed の順序で処理
  const sourceData = [
    { ids: envModels, key: "env" as const },
    { ids: fileModels, key: "file" as const },
    { ids: fixedModelIds, key: "fixed" as const },
  ];

  for (const { ids, key } of sourceData) {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        models.push({
          id,
          object: "model",
          created,
          owned_by: "antigravity",
        });
      }
    }
  }

  return {
    models,
    sources,
  };
}

export function parseEnvModels(value: string | undefined, logger: Logger): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const redactedValue = redactSensitiveValue(trimmed);

  let items: unknown[];
  if (trimmed.startsWith("[")) {
    // まずJSON配列としてパースを試みる
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        logger.warn("parseEnvModels: JSON value is not an array, falling back to CSV", {
          value: redactedValue,
        });
        items = trimmed.split(",");
      } else {
        items = parsed;
      }
    } catch (error) {
      // JSON.parseが失敗した場合、カンマ区切り文字列としてフォールバック
      logger.warn("parseEnvModels: JSON.parse failed, falling back to CSV", {
        value: redactedValue,
        error: error instanceof Error ? error.message : String(error),
      });
      items = trimmed.split(",");
    }
  } else {
    items = trimmed.split(",");
  }

  // 各アイテムをクリーンアップ：trim、文字列のみ、空/空白のみを除外
  const cleaned = items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (cleaned.length === 0) {
    logger.warn("parseEnvModels: no valid model IDs after parsing", {
      value: redactedValue,
    });
  }

  return cleaned;
}

async function readFileModels(
  paths: readonly string[],
  logger: Logger,
  skipPathSafetyCheck: boolean = false
): Promise<string[]> {
  if (paths.length === 0) return [];

  const candidatePaths: string[] = [];
  for (const filePath of paths) {
    // パストラバーサル保護：'..' を含むパスや絶対パスを拒否（テスト環境ではスキップ可能）
    if (!skipPathSafetyCheck && isUnsafePath(filePath)) {
      logger.warn("readFileModels: rejecting unsafe path", {
        filePath,
        reason: "path contains '..' or is absolute",
      });
      continue;
    }
    candidatePaths.push(filePath);
  }

  if (candidatePaths.length === 0) return [];

  let cwdRealpath: string | null = null;
  if (!skipPathSafetyCheck) {
    try {
      cwdRealpath = await realpath(process.cwd());
    } catch (error) {
      logger.error("Failed to resolve cwd realpath for custom models safety check", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  const existingPaths: string[] = [];
  for (const filePath of candidatePaths) {
    try {
      if (await Bun.file(filePath).exists()) {
        if (!skipPathSafetyCheck && cwdRealpath) {
          const resolvedPath = await resolveRealPath(filePath, logger);
          if (!resolvedPath) {
            continue;
          }
          if (!isPathWithinBase(resolvedPath, cwdRealpath)) {
            logger.warn("readFileModels: rejecting path outside cwd", {
              filePath,
              resolvedPath,
              cwd: cwdRealpath,
            });
            continue;
          }
        }
        existingPaths.push(filePath);
      }
    } catch (error) {
      logger.error("Failed to check custom models file", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (existingPaths.length === 0) {
    logger.info("Custom models file not found, continuing with fixed models", {
      paths: candidatePaths,
    });
    return [];
  }

  const selectedPath = existingPaths[0];
  const ignoredPaths = existingPaths.slice(1);
  if (ignoredPaths.length > 0) {
    logger.info(
      `Loaded custom models from ${selectedPath}, ignoring ${ignoredPaths.join(", ")}`,
      {
        selectedPath,
        ignoredPaths,
      }
    );
  }

  let contents: string;
  try {
    contents = await Bun.file(selectedPath).text();
  } catch (error) {
    logger.error("Failed to read custom models file", {
      path: selectedPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    logger.error("Failed to parse custom models file as JSON", {
      path: selectedPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    logger.error("Custom models file has invalid shape", {
      path: selectedPath,
    });
    return [];
  }

  const cleaned = parsed.models
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return cleaned;
}

async function resolveRealPath(
  filePath: string,
  logger: Logger
): Promise<string | null> {
  try {
    return await realpath(filePath);
  } catch (error) {
    logger.error("Failed to resolve custom models file realpath", {
      filePath,
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

export function isUnsafePath(filePath: string): boolean {
  // 絶対パスかチェック（Unix: / で始まる、Windows: ドライブレター）
  if (filePath.startsWith("/") || /^[a-zA-Z]:\\/.test(filePath)) {
    return true;
  }
  // '..' を含むパスを拒否
  if (filePath.includes("..")) {
    return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function redactSensitiveValue(value: string): string {
  return value.replace(/sk-(proj-)?[a-zA-Z0-9-_]+/g, (_match, proj) =>
    proj ? "sk-proj-***" : "sk-***"
  );
}
