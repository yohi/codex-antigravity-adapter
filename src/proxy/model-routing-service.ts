import type { ModelAliasConfigService } from "../config/model-alias-config-service";
import type { Logger } from "../logging";
import type { ChatCompletionRequest } from "../transformer/schema";
import { detectAlias } from "../utils/detect-alias";

export interface RoutingResult {
  request: ChatCompletionRequest;
  routed: boolean;
  detectedAlias?: string;
  originalModel?: string;
}

export interface ModelRoutingService {
  route(request: ChatCompletionRequest): RoutingResult;
}

export interface CreateModelRoutingServiceOptions {
  aliasConfig: ModelAliasConfigService;
  logger?: Logger;
}

export function createModelRoutingService(
  options: CreateModelRoutingServiceOptions
): ModelRoutingService {
  const { aliasConfig, logger } = options;

  return {
    route(request: ChatCompletionRequest): RoutingResult {
      try {
        // 1. Find last user message
        let lastUserIndex = -1;
        for (let i = request.messages.length - 1; i >= 0; i--) {
          if (request.messages[i].role === "user") {
            lastUserIndex = i;
            break;
          }
        }

        if (lastUserIndex === -1) {
          return { request, routed: false };
        }

        const lastUserMessage = request.messages[lastUserIndex];
        // Content is guaranteed to be string by schema transform, but check to be safe if types lie
        if (typeof lastUserMessage.content !== "string") {
            return { request, routed: false };
        }

        // 2. Detect alias
        const knownAliases = new Set(aliasConfig.listAliases());
        const { alias, remainingContent } = detectAlias(lastUserMessage.content, knownAliases);

        if (alias) {
          const targetModel = aliasConfig.getTargetModel(alias);
          // Should exist if it was in listAliases, but check anyway
          if (targetModel) {
            const originalModel = request.model;

            // 3. Clone and update request
            // Shallow clone of request object
            const newRequest = { ...request };
            
            // Update model
            newRequest.model = targetModel;

            // Update messages (Need to clone the array and the modified message)
            newRequest.messages = [...request.messages];
            newRequest.messages[lastUserIndex] = {
              ...lastUserMessage,
              content: remainingContent,
            };

            logger?.debug(
              `Model routed via alias: ${alias} -> ${targetModel} (was: ${originalModel})`
            );

            return {
              request: newRequest,
              routed: true,
              detectedAlias: alias,
              originalModel: originalModel,
            };
          }
        }

        return { request, routed: false };
      } catch (e) {
        logger?.error(`Error in model routing service: ${e}`);
        // Fail open
        return { request, routed: false };
      }
    },
  };
}