import type { ModelAliasConfigService } from "../config/model-alias-config-service";
import type { Logger } from "../logging";
import { NOOP_LOGGER } from "../logging";
import type { ChatCompletionRequest } from "../transformer/schema";

export type RoutingResult = {
  request: ChatCompletionRequest;
  routed: boolean;
  detectedAlias?: string;
  originalModel?: string;
};

export type ModelRoutingService = {
  route: (request: ChatCompletionRequest) => RoutingResult;
};

export type CreateModelRoutingServiceOptions = {
  aliasConfig: ModelAliasConfigService;
  logger?: Logger;
};

export function createModelRoutingService(
  options: CreateModelRoutingServiceOptions
): ModelRoutingService {
  const logger = options.logger ?? NOOP_LOGGER;
  const aliasConfig = options.aliasConfig;

  return {
    route: (request) => {
      void logger;
      void aliasConfig;
      return { request, routed: false };
    },
  };
}
