import type { ChatCompletionRequest } from "./schema";

export type TransformError = {
  code: "INVALID_MESSAGE_FORMAT" | "UNSUPPORTED_FEATURE" | "SIGNATURE_CACHE_MISS";
  message: string;
  field?: string;
};

export type TransformResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TransformError };

export type AntigravityContentPart = {
  text: string;
};

export type AntigravityContent = {
  role: "user" | "model";
  parts: AntigravityContentPart[];
};

export type AntigravityRequestPayload = {
  model: string;
  request: {
    contents: AntigravityContent[];
    systemInstruction?: { parts: AntigravityContentPart[] };
    generationConfig?: {
      temperature?: number;
      maxOutputTokens?: number;
    };
  };
};

export function transformRequestBasics(
  request: ChatCompletionRequest
): TransformResult<AntigravityRequestPayload> {
  if (request.tools && request.tools.length > 0) {
    return unsupportedFeature("tools", "Tools are not supported yet.");
  }
  if (request.tool_choice) {
    return unsupportedFeature("tool_choice", "tool_choice is not supported yet.");
  }

  const contents: AntigravityContent[] = [];
  const systemParts: AntigravityContentPart[] = [];

  for (const message of request.messages) {
    switch (message.role) {
      case "system":
        systemParts.push({ text: message.content });
        break;
      case "user":
        contents.push({ role: "user", parts: [{ text: message.content }] });
        break;
      case "assistant": {
        if (message.tool_calls && message.tool_calls.length > 0) {
          return unsupportedFeature(
            "messages.tool_calls",
            "Assistant tool_calls are not supported yet."
          );
        }
        if (typeof message.content !== "string") {
          return invalidMessage(
            "messages.content",
            "Assistant content must be a string."
          );
        }
        contents.push({ role: "model", parts: [{ text: message.content }] });
        break;
      }
      case "tool":
        return unsupportedFeature(
          "messages.tool",
          "Tool role messages are not supported yet."
        );
    }
  }

  const payload: AntigravityRequestPayload = {
    model: mapModelToAntigravity(request.model),
    request: {
      contents,
    },
  };

  if (systemParts.length > 0) {
    payload.request.systemInstruction = { parts: systemParts };
  }

  const generationConfig: AntigravityRequestPayload["request"]["generationConfig"] = {};
  if (request.temperature !== undefined) {
    generationConfig.temperature = request.temperature;
  }
  if (request.max_tokens !== undefined) {
    generationConfig.maxOutputTokens = request.max_tokens;
  }
  if (Object.keys(generationConfig).length > 0) {
    payload.request.generationConfig = generationConfig;
  }

  return { ok: true, value: payload };
}

function mapModelToAntigravity(model: string): string {
  return model;
}

function unsupportedFeature(field: string, message: string): TransformResult<never> {
  return { ok: false, error: { code: "UNSUPPORTED_FEATURE", message, field } };
}

function invalidMessage(field: string, message: string): TransformResult<never> {
  return { ok: false, error: { code: "INVALID_MESSAGE_FORMAT", message, field } };
}
