import type { Logger } from "../logging";

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

  const envModels = parseEnvModels(process.env[envVar]);
  const fileModels = await readFileModels(options.customModelPaths ?? []);
  const created = Math.floor(now() / 1000);

  const models = [...envModels, ...fileModels, ...fixedModelIds].map((id) => ({
    id,
    object: "model" as const,
    created,
    owned_by: "antigravity",
  }));

  return {
    models,
    sources: {
      fixed: fixedModelIds.length,
      file: fileModels.length,
      env: envModels.length,
    },
  };
}

function parseEnvModels(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

async function readFileModels(paths: readonly string[]): Promise<string[]> {
  for (const filePath of paths) {
    try {
      const contents = await Bun.file(filePath).text();
      const parsed = JSON.parse(contents);
      if (isRecord(parsed) && Array.isArray(parsed.models)) {
        return parsed.models.filter((item): item is string => typeof item === "string");
      }
    } catch {
      continue;
    }
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
