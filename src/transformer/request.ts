import type { ChatCompletionRequest } from "./schema";

export type TransformError = {
  code: "INVALID_MESSAGE_FORMAT" | "UNSUPPORTED_FEATURE" | "SIGNATURE_CACHE_MISS";
  message: string;
  field?: string;
};

export type TransformResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TransformError };

export type AntigravityFunctionCallPart = {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
};

export type AntigravityFunctionResponsePart = {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
  };
};

export type AntigravityContentPart =
  | { text: string }
  | AntigravityFunctionCallPart
  | AntigravityFunctionResponsePart;

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
    tools?: Array<unknown>;
    toolConfig?: Record<string, unknown>;
  };
};

export function transformRequestBasics(
  request: ChatCompletionRequest
): TransformResult<AntigravityRequestPayload> {
  const contents: AntigravityContent[] = [];
  const systemParts: AntigravityContentPart[] = [];
  const toolCallNameById = new Map<string, string>();
  const toolCallIdByOriginal = new Map<string, string>();
  const isClaude = isClaudeModel(request.model);
  let toolCallIndex = 0;

  const toolsResult = buildTools(request);
  if (!toolsResult.ok) {
    return toolsResult;
  }

  for (const message of request.messages) {
    switch (message.role) {
      case "system":
        systemParts.push({ text: message.content });
        break;
      case "user":
        contents.push({ role: "user", parts: [{ text: message.content }] });
        break;
      case "assistant": {
        const parts: AntigravityContentPart[] = [];
        if (typeof message.content === "string") {
          parts.push({ text: message.content });
        }
        if (message.tool_calls) {
          for (const toolCall of message.tool_calls) {
            if (!isValidToolName(toolCall.function.name)) {
              return invalidMessage(
                "messages.tool_calls.function.name",
                "Tool name contains invalid characters."
              );
            }
            const parsedArgs = parseJsonObject(
              toolCall.function.arguments,
              "messages.tool_calls.function.arguments"
            );
            if (!parsedArgs.ok) {
              return parsedArgs;
            }
            const normalizedId = isClaude
              ? `call_${++toolCallIndex}`
              : toolCall.id;
            toolCallIdByOriginal.set(toolCall.id, normalizedId);
            toolCallNameById.set(normalizedId, toolCall.function.name);
            parts.push({
              functionCall: {
                name: toolCall.function.name,
                args: parsedArgs.value,
              },
            });
          }
        }
        if (parts.length === 0) {
          return invalidMessage(
            "messages.content",
            "Assistant content must be a string."
          );
        }
        contents.push({ role: "model", parts });
        break;
      }
      case "tool": {
        const normalizedId = isClaude
          ? toolCallIdByOriginal.get(message.tool_call_id)
          : message.tool_call_id;
        if (!normalizedId) {
          return invalidMessage(
            "messages.tool_call_id",
            "Unknown tool_call_id for tool response."
          );
        }
        const toolName = toolCallNameById.get(normalizedId);
        if (!toolName) {
          return invalidMessage(
            "messages.tool_call_id",
            "Unknown tool_call_id for tool response."
          );
        }
        const parsedResponse = parseJsonObject(
          message.content,
          "messages.tool.content"
        );
        if (!parsedResponse.ok) {
          return parsedResponse;
        }
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: toolName,
                response: parsedResponse.value,
              },
            },
          ],
        });
        break;
      }
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

  if (toolsResult.value.tools) {
    payload.request.tools = toolsResult.value.tools;
  }
  if (toolsResult.value.toolConfig) {
    payload.request.toolConfig = toolsResult.value.toolConfig;
  }

  return { ok: true, value: payload };
}

function mapModelToAntigravity(model: string): string {
  return model;
}

function buildTools(
  request: ChatCompletionRequest
): TransformResult<{
  tools?: Array<unknown>;
  toolConfig?: Record<string, unknown>;
  toolNames?: string[];
}> {
  const toolNames: string[] = [];
  let tools: Array<unknown> | undefined;
  let toolConfig: Record<string, unknown> | undefined;

  if (request.tools && request.tools.length > 0) {
    const functionDeclarations: Record<string, unknown>[] = [];
    for (const tool of request.tools) {
      const name = tool.function.name;
      if (!isValidToolName(name)) {
        return invalidMessage("tools.function.name", "Tool name is invalid.");
      }
      toolNames.push(name);
      const declaration: Record<string, unknown> = { name };
      if (tool.function.description) {
        declaration.description = tool.function.description;
      }
      if (tool.function.parameters) {
        declaration.parameters = sanitizeSchema(tool.function.parameters);
      }
      functionDeclarations.push(declaration);
    }
    tools = [{ functionDeclarations }];
  }

  if (request.tool_choice) {
    if (request.tool_choice === "auto") {
      toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    } else if (request.tool_choice.type === "function") {
      const name = request.tool_choice.function.name;
      if (!isValidToolName(name)) {
        return invalidMessage(
          "tool_choice.function.name",
          "Tool name is invalid."
        );
      }
      if (toolNames.length > 0 && !toolNames.includes(name)) {
        return invalidMessage(
          "tool_choice.function.name",
          "tool_choice function must exist in tools."
        );
      }
      toolConfig = {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [name],
        },
      };
    } else {
      return unsupportedFeature(
        "tool_choice",
        "tool_choice is not supported yet."
      );
    }
  }

  return { ok: true, value: { tools, toolConfig, toolNames } };
}

function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSchema(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const obj = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  let constValue: unknown;

  for (const [key, entry] of Object.entries(obj)) {
    if (key === "const") {
      constValue = entry;
      continue;
    }
    if (shouldDropKey(key)) {
      continue;
    }
    sanitized[key] = sanitizeSchema(entry);
  }

  if (constValue !== undefined) {
    sanitized.enum = [constValue];
  }

  return sanitized;
}

function shouldDropKey(key: string): boolean {
  return (
    key === "$ref" ||
    key === "$schema" ||
    key === "$id" ||
    key === "default" ||
    key === "examples"
  );
}

function parseJsonObject(
  value: string,
  field: string
): TransformResult<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return invalidMessage(field, "Expected a JSON object.");
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return invalidMessage(field, "Expected valid JSON.");
  }
}

function isClaudeModel(model: string): boolean {
  return model.toLowerCase().includes("claude");
}

function isValidToolName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name);
}

function unsupportedFeature(field: string, message: string): TransformResult<never> {
  return { ok: false, error: { code: "UNSUPPORTED_FEATURE", message, field } };
}

function invalidMessage(field: string, message: string): TransformResult<never> {
  return { ok: false, error: { code: "INVALID_MESSAGE_FORMAT", message, field } };
}
