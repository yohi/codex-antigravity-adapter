import type { Logger } from "../logging";

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
  _options?: LoadAliasesOptions
): Promise<ModelAliasConfigService> {
  const aliasMap = new Map<string, string>();
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
