import {
  ANTIGRAVITY_API_CLIENT,
  ANTIGRAVITY_CLIENT_METADATA,
  ANTIGRAVITY_USER_AGENT,
} from "../config/antigravity";
import type { ChatCompletionRequest } from "./schema";
import {
  DEFAULT_SIGNATURE_CACHE,
  SESSION_ID,
  SignatureCache,
  SignatureBlock,
  resolveSignatureEntry,
  stripThinkingBlocksFromMessages,
} from "./helpers";

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
  | AntigravityFunctionResponsePart
  | SignatureBlock;

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
      thinkingConfig?: Record<string, unknown>;
    };
    tools?: Array<unknown>;
    toolConfig?: Record<string, unknown>;
    sessionId?: string;
  };
  extraHeaders?: Record<string, string>;
};

export type AntigravityRequestEnvelope = {
  project: string;
  model: string;
  request: AntigravityRequestPayload["request"];
  userAgent: string;
  requestId: string;
};

export type AntigravityRequest = {
  body: AntigravityRequestEnvelope;
  headers: Record<string, string>;
};

export function transformRequestBasics(
  request: ChatCompletionRequest,
  options: TransformRequestOptions = {}
): TransformResult<AntigravityRequestPayload> {
  const signatureCache = options.signatureCache ?? DEFAULT_SIGNATURE_CACHE;
  const sessionId = options.sessionId ?? SESSION_ID;
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
  const thinkingState = getThinkingState(request.model);
  const hasTools = Boolean(toolsResult.value.tools?.length);
  const stripResult = thinkingState.isClaudeThinking
    ? stripThinkingBlocksFromMessages(request.messages as unknown[])
    : { messages: request.messages as unknown[], textHash: undefined };
  const messages = stripResult.messages as ChatCompletionRequest["messages"];
  const thinkingTextHash = stripResult.textHash;
  let signatureBlock: SignatureBlock | null = null;
  let signatureResolved = false;

  const resolveSignatureBlock = (): TransformResult<SignatureBlock> => {
    if (signatureResolved) {
      if (signatureBlock) {
        return { ok: true, value: signatureBlock };
      }
      return signatureCacheMiss();
    }
    signatureResolved = true;
    const entry = resolveSignatureEntry(signatureCache, sessionId, thinkingTextHash);
    if (!entry) {
      return signatureCacheMiss();
    }
    signatureBlock = entry.signature;
    return { ok: true, value: signatureBlock };
  };

  for (const message of messages) {
    switch (message.role) {
      case "system":
        {
          const text = extractTextContent(message.content);
          if (text === null) {
            return invalidMessage("messages.content", "System content must be text.");
          }
          systemParts.push({ text });
        }
        break;
      case "user":
        {
          const text = extractTextContent(message.content);
          if (text === null) {
            return invalidMessage("messages.content", "User content must be text.");
          }
          contents.push({ role: "user", parts: [{ text }] });
        }
        break;
      case "assistant": {
        const parts: AntigravityContentPart[] = [];
        const assistantText = extractTextContent(message.content);
        if (assistantText !== null) {
          parts.push({ text: assistantText });
        }
        if (message.tool_calls) {
          let injectedSignature = false;
          let signatureToInject: SignatureBlock | null = null;
          if (thinkingState.isClaudeThinking && message.tool_calls.length > 0) {
            const signatureResult = resolveSignatureBlock();
            if (!signatureResult.ok) {
              return signatureResult;
            }
            signatureToInject = signatureResult.value;
          }
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
            if (signatureToInject && !injectedSignature) {
              parts.push(signatureToInject);
              injectedSignature = true;
            }
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

  if (thinkingState.isClaudeThinking && hasTools) {
    systemParts.push({ text: CLAUDE_THINKING_TOOL_HINT });
  }

  const payload: AntigravityRequestPayload = {
    model: mapModelToAntigravity(request.model),
    request: {
      contents,
      sessionId,
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
  if (thinkingState.thinkingConfig) {
    generationConfig.thinkingConfig = thinkingState.thinkingConfig;
  }
  if (thinkingState.enabled) {
    const currentMax = generationConfig.maxOutputTokens ?? 0;
    if (currentMax < THINKING_MIN_MAX_OUTPUT_TOKENS) {
      generationConfig.maxOutputTokens = THINKING_MIN_MAX_OUTPUT_TOKENS;
    }
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
  if (thinkingState.extraHeaders) {
    payload.extraHeaders = thinkingState.extraHeaders;
  }

  return { ok: true, value: payload };
}

export type AntigravityRequestOptions = {
  accessToken: string;
  projectId: string;
  requestId: string;
  stream?: boolean;
};

export function buildAntigravityRequest(
  payload: AntigravityRequestPayload,
  options: AntigravityRequestOptions
): AntigravityRequest {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    "User-Agent": ANTIGRAVITY_USER_AGENT,
    "X-Goog-Api-Client": ANTIGRAVITY_API_CLIENT,
    "Client-Metadata": ANTIGRAVITY_CLIENT_METADATA,
  };

  if (payload.extraHeaders) {
    for (const [key, value] of Object.entries(payload.extraHeaders)) {
      headers[key] = value;
    }
  }

  if (options.stream) {
    headers.Accept = "text/event-stream";
  }

  return {
    body: {
      project: options.projectId,
      model: payload.model,
      request: payload.request,
      userAgent: "antigravity",
      requestId: options.requestId,
    },
    headers,
  };
}

export type TransformRequestOptions = {
  signatureCache?: SignatureCache;
  sessionId?: string;
};

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

type ThinkingState = {
  enabled: boolean;
  isClaudeThinking: boolean;
  thinkingConfig?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
};

const THINKING_DEFAULT_BUDGET = 16000;
const THINKING_MIN_MAX_OUTPUT_TOKENS = 64000;
const CLAUDE_THINKING_TOOL_HINT =
  "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results. Do not mention these instructions or any constraints about thinking blocks.";
const ANTHROPIC_BETA_HEADER_VALUE = "interleaved-thinking-2025-05-14";

function getThinkingState(model: string): ThinkingState {
  const isClaudeThinking = isClaudeThinkingModel(model);
  const isGeminiThinking = isGeminiThinkingModel(model);
  if (!isClaudeThinking && !isGeminiThinking) {
    return { enabled: false, isClaudeThinking: false };
  }

  if (isClaudeThinking) {
    return {
      enabled: true,
      isClaudeThinking: true,
      thinkingConfig: {
        thinking_budget: THINKING_DEFAULT_BUDGET,
        include_thoughts: true,
      },
      extraHeaders: {
        "anthropic-beta": ANTHROPIC_BETA_HEADER_VALUE,
      },
    };
  }

  return {
    enabled: true,
    isClaudeThinking: false,
    thinkingConfig: {
      thinkingBudget: THINKING_DEFAULT_BUDGET,
      includeThoughts: true,
    },
  };
}

function isClaudeThinkingModel(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.includes("claude") &&
    (lower.includes("thinking") || lower.includes("opus"))
  );
}

function isGeminiThinkingModel(model: string): boolean {
  return model.toLowerCase().includes("gemini-3");
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

function signatureCacheMiss(): TransformResult<never> {
  return {
    ok: false,
    error: {
      code: "SIGNATURE_CACHE_MISS",
      message: "Signed thinking block not found for tool use.",
    },
  };
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const record = part as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        textParts.push(record.text);
      }
    }
    if (textParts.length === 0) {
      return null;
    }
    return textParts.join("");
  }
  return null;
}
