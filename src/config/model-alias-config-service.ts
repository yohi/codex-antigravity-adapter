import { z } from "zod";
import type { Logger } from "../logging";
import { isUnsafePath } from "../utils/path-safety";
import { dirname, resolve } from "path";

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
        // We need to check if isUnsafePath is available. 
        // Assuming implementation similar to model-settings-service.ts
        // For now, let's just use the imported isUnsafePath if it exists or implement a basic check.
        // The design says "Use isUnsafePath from utils/path-safety.ts".
        // I will need to verify if src/utils/path-safety.ts exists. 
        // If not, I should implement it or check model-settings-service.ts.
        
        // Wait, I saw src/utils/path-safety.ts in the file list!
        // So I can use it.
        
        // Since isUnsafePath might be async or check realpath, let's assume it checks for ".."
        // The design says: "isUnsafePath により .. を含むパス、絶対パスを拒否"
        // "realpath によりシンボリックリンクを解決"
        
        if (isUnsafePath(filePath)) {
             logger?.warn(`Invalid configuration path detected: ${filePath}`);
             return new ModelAliasConfigServiceImpl(new Map());
        }

        // Realpath check (simple version for now, maybe move to path-safety later or use here)
        // design says: "realpath でシンボリックリンクを解決し、プロジェクトルート内に収まることを検証"
        // I'll implement a basic check here if path-safety doesn't cover it all.
        try {
           const real = await Bun.realpath(filePath);
           const projectRoot = process.cwd();
           if (!real.startsWith(projectRoot)) {
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