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
};

export type ModelSettingsService = {
  load: (options?: ModelSettingsOptions) => Promise<ModelCatalog>;
};

const DEFAULT_ENV_VAR = "ANTIGRAVITY_ADDITIONAL_MODELS";
const DEFAULT_FIXED_MODEL_IDS = [
  "gemini-3-pro-high",
  "gemini-3-pro-low",
  "gemini-3-flash",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-thinking",
  "claude-opus-4-5-thinking",
  "gpt-oss-120b-medium",
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

  const envModels = parseEnvModels(process.env[envVar], logger);
  const fileModels = await readFileModels(options.customModelPaths ?? [], logger);
  const created = Math.floor(now() / 1000);

  // 重複排除: first-seen-wins（env → file → fixed の優先順位）
  const seen = new Set<string>();
  const models: AvailableModel[] = [];
  const sources: ModelSourceCounts = {
    env: 0,
    file: 0,
    fixed: 0,
  };

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
        sources[key]++;
      }
    }
  }

  return {
    models,
    sources,
  };
}

function parseEnvModels(value: string | undefined, logger: Logger): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  let items: unknown[];
  if (trimmed.startsWith("[")) {
    // まずJSON配列としてパースを試みる
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        logger.warn("parseEnvModels: JSON value is not an array, falling back to CSV", {
          value: trimmed,
        });
        items = trimmed.split(",");
      } else {
        items = parsed;
      }
    } catch (error) {
      // JSON.parseが失敗した場合、カンマ区切り文字列としてフォールバック
      logger.warn("parseEnvModels: JSON.parse failed, falling back to CSV", {
        value: trimmed,
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
      value: trimmed,
    });
  }

  return cleaned;
}

async function readFileModels(
  paths: readonly string[],
  logger: Logger
): Promise<string[]> {
  if (paths.length === 0) return [];

  // 複数ファイルが設定されている場合は通知
  if (paths.length > 1) {
    logger.info("readFileModels: multiple files configured, only first valid file will be used", {
      count: paths.length,
      paths,
    });
  }

  for (const filePath of paths) {
    // パストラバーサル保護：'..' を含むパスや絶対パスを拒否
    if (isUnsafePath(filePath)) {
      logger.warn("readFileModels: rejecting unsafe path", {
        filePath,
        reason: "path contains '..' or is absolute",
      });
      continue;
    }

    try {
      const contents = await Bun.file(filePath).text();
      const parsed = JSON.parse(contents);
      if (isRecord(parsed) && Array.isArray(parsed.models)) {
        // 文字列のみをフィルタリングし、trim して空白のみのIDを除外
        const cleaned = parsed.models
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        return cleaned;
      }
    } catch (error) {
      // ファイル読み取り/JSONパースエラーをログに記録
      logger.error("readFileModels: failed to read or parse file", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
  }
  return [];
}

function isUnsafePath(filePath: string): boolean {
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
