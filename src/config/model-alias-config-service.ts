import { z } from "zod";
import type { Logger } from "../logging";
import { isUnsafePath } from "../utils/path-safety";
import { resolve, relative, isAbsolute } from "path";

export type AliasMap = ReadonlyMap<string, string>;

export interface ModelAliasConfigService {
  getTargetModel(alias: string): string | undefined;
  hasAlias(alias: string): boolean;
  listAliases(): readonly string[];
  getAll(): AliasMap;
}

export interface LoadAliasesOptions {
  filePath?: string;
  logger?: Logger;
  skipPathSafetyCheck?: boolean;
}

const AliasTagSchema = z.string().regex(/^@[a-zA-Z][a-zA-Z0-9_-]*$/);
const AliasEntrySchema = z.record(z.string());

class ModelAliasConfigServiceImpl implements ModelAliasConfigService {
  constructor(private readonly aliases: AliasMap) {}

  getTargetModel(alias: string): string | undefined {
    return this.aliases.get(alias);
  }

  hasAlias(alias: string): boolean {
    return this.aliases.has(alias);
  }

  listAliases(): readonly string[] {
    return Array.from(this.aliases.keys());
  }

  getAll(): AliasMap {
    return this.aliases;
  }
}

export type ModelAliasConfigServiceFactory = {
  loadAliases(options?: LoadAliasesOptions): Promise<ModelAliasConfigService>;
};

export function createModelAliasConfigService(): ModelAliasConfigServiceFactory {
  return {
    async loadAliases(options: LoadAliasesOptions = {}): Promise<ModelAliasConfigService> {
      const filePath = options.filePath || "model-aliases.json";
      const logger = options.logger;
      const skipPathSafetyCheck = options.skipPathSafetyCheck ?? false;

      // Path safety check
      if (!skipPathSafetyCheck) {
        // Reject unsafe paths (e.g. containing "..")
        if (isUnsafePath(filePath)) {
             logger?.warn(`Invalid configuration path detected: ${filePath}`);
             return new ModelAliasConfigServiceImpl(new Map());
        }

        // Ensure path resolves within project root
        try {
           const real = await Bun.realpath(filePath);
           const projectRoot = process.cwd();
           const rel = relative(projectRoot, real);
           if (rel.startsWith('..') || isAbsolute(rel)) {
               logger?.warn(`Configuration path traverses outside project root: ${filePath}`);
               return new ModelAliasConfigServiceImpl(new Map());
           }
        } catch (e) {
            // File might not exist, which is handled below
        }
      }

      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        logger?.info(`Model aliases file not found at ${filePath}. Using empty configuration.`);
        return new ModelAliasConfigServiceImpl(new Map());
      }

      let content: string;
      try {
        content = await file.text();
      } catch (e) {
        logger?.warn(`Failed to read model aliases file: ${e}`);
        return new ModelAliasConfigServiceImpl(new Map());
      }

      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch (e) {
        logger?.warn(`Failed to parse model aliases file as JSON: ${e}`);
        return new ModelAliasConfigServiceImpl(new Map());
      }

      const parsed = AliasEntrySchema.safeParse(json);
      if (!parsed.success) {
        logger?.warn(`Model aliases file invalid structure. Expected JSON object with string values.`);
        return new ModelAliasConfigServiceImpl(new Map());
      }

      const aliasMap = new Map<string, string>();
      for (const [key, value] of Object.entries(parsed.data)) {
        if (!AliasTagSchema.safeParse(key).success) {
            logger?.warn(`Skipping invalid alias tag: "${key}". Must start with @ and contain only alphanumeric/underscore/dash.`);
            continue;
        }
        if (!value || typeof value !== 'string' || value.trim() === '') {
             logger?.warn(`Skipping invalid target model for alias "${key}": "${value}". Must be a non-empty string.`);
             continue;
        }
        aliasMap.set(key, value);
      }

      return new ModelAliasConfigServiceImpl(aliasMap);
    },
  };
}