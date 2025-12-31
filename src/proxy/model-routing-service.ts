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

function findLastUserMessageIndex(
  messages: ChatCompletionRequest["messages"]
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return index;
    }
  }
  return -1;
}

export function getLatestUserMessageContent(
  messages: ChatCompletionRequest["messages"]
): string | null {
  const lastUserMessageIndex = findLastUserMessageIndex(messages);
  if (lastUserMessageIndex === -1) {
    return null;
  }

  const lastUserMessage = messages[lastUserMessageIndex];
  if (lastUserMessage.role !== "user") {
    return null;
  }

  return lastUserMessage.content;
}

export function createModelRoutingService(
  options: CreateModelRoutingServiceOptions
): ModelRoutingService {
  const logger = options.logger ?? NOOP_LOGGER;
  const aliasConfig = options.aliasConfig;

  return {
    route: (request) => {
      void logger;
      void aliasConfig;
      const latestUserMessageContent = getLatestUserMessageContent(
        request.messages
      );
      if (latestUserMessageContent === null) {
        return { request, routed: false };
      }
      return { request, routed: false };
    },
  };
}
