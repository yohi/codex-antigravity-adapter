export type TransformError = {
  code: "INVALID_MESSAGE_FORMAT" | "UNSUPPORTED_FEATURE" | "SIGNATURE_CACHE_MISS";
  message: string;
  field?: string;
};

export type TransformResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TransformError };

export type AntigravityContentPart = {
  text?: string;
  functionCall?: AntigravityFunctionCall;
  functionResponse?: Record<string, unknown>;
};

export type AntigravityFunctionCall = {
  id?: unknown;
  name?: unknown;
  args?: unknown;
};

export type AntigravityContent = {
  role?: string;
  parts?: AntigravityContentPart[];
};

export type AntigravityCandidate = {
  content?: AntigravityContent;
  finishReason?: string;
  index?: number;
};

export type AntigravityUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export type AntigravityResponse = {
  model?: string;
  candidates?: AntigravityCandidate[];
  usageMetadata?: AntigravityUsageMetadata;
};

export type ChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: "stop" | "length" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type TransformResponseOptions = {
  now?: () => number;
};

export type TransformStreamOptions = {
  now?: () => number;
};

export type ChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: "stop" | "length" | null;
  }>;
};

export function transformSingle(
  response: AntigravityResponse,
  requestId: string,
  sessionId: string,
  options: TransformResponseOptions = {}
): TransformResult<ChatCompletionResponse> {
  void sessionId;
  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    return invalidMessage("candidates", "Response candidates are missing.");
  }

  const choices: ChatCompletionResponse["choices"] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const content = candidate.content;
    if (!content || !Array.isArray(content.parts)) {
      return invalidMessage(
        "candidates.content",
        "Candidate content is missing."
      );
    }
    if (content.role && content.role !== "model") {
      return invalidMessage(
        "candidates.content.role",
        "Candidate role must be model."
      );
    }

    const choiceIndex =
      typeof candidate.index === "number" ? candidate.index : index;
    const partsResult = extractMessageParts(content.parts);
    if (!partsResult.ok) {
      return partsResult;
    }
    const message: ChatCompletionResponse["choices"][number]["message"] = {
      role: "assistant",
      content: partsResult.value.content,
    };
    if (partsResult.value.tool_calls) {
      message.tool_calls = partsResult.value.tool_calls;
    }

    choices.push({
      index: choiceIndex,
      message,
      finish_reason: mapFinishReason(candidate.finishReason),
    });
  }

  const now = options.now ?? (() => Date.now());
  const created = Math.floor(now() / 1000);
  const model =
    typeof response.model === "string" && response.model.length > 0
      ? response.model
      : "unknown";
  const usage = buildUsage(response.usageMetadata);

  const result: ChatCompletionResponse = {
    id: `chatcmpl-${requestId}`,
    object: "chat.completion",
    created,
    model,
    choices,
  };

  if (usage) {
    result.usage = usage;
  }

  return { ok: true, value: result };
}

export function transformStream(
  stream: ReadableStream<Uint8Array>,
  requestId: string,
  sessionId: string,
  options: TransformStreamOptions = {}
): ReadableStream<Uint8Array> {
  void sessionId;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const now = options.now ?? (() => Date.now());
  const roleEmitted = new Set<number>();
  const toolCallIndexByChoice = new Map<number, number>();
  let buffer = "";
  let currentModel = "unknown";
  let doneSent = false;
  let stopReading = false;

  const enqueueData = (data: string) => {
    controller.enqueue(encoder.encode(`data: ${data}\n\n`));
  };

  const enqueueDone = () => {
    if (doneSent) {
      return;
    }
    doneSent = true;
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  };

  const enqueueError = (error: { type: string; code: string; message: string }) => {
    enqueueData(JSON.stringify({ error }));
  };

  const processEvent = (event: string) => {
    const data = extractSseData(event);
    if (!data) {
      return;
    }
    if (data === "[DONE]") {
      enqueueDone();
      stopReading = true;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      enqueueError({
        type: "server_error",
        code: "internal_error",
        message: "Invalid SSE payload.",
      });
      stopReading = true;
      return;
    }

    const upstreamError = extractUpstreamError(payload);
    if (upstreamError) {
      enqueueError(upstreamError);
      stopReading = true;
      return;
    }

    const response = extractResponsePayload(payload);
    if (!response) {
      enqueueError({
        type: "server_error",
        code: "internal_error",
        message: "Missing response payload.",
      });
      stopReading = true;
      return;
    }

    if (typeof response.model === "string" && response.model.length > 0) {
      currentModel = response.model;
    }

    const chunkResult = buildChunkFromResponse(
      response,
      requestId,
      currentModel,
      Math.floor(now() / 1000),
      roleEmitted,
      toolCallIndexByChoice
    );

    if (!chunkResult.ok) {
      enqueueError(mapTransformError(chunkResult.error));
      stopReading = true;
      return;
    }

    enqueueData(JSON.stringify(chunkResult.value));
  };

  let controller: ReadableStreamDefaultController<Uint8Array>;

  return new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      const reader = stream.getReader();
      (async () => {
        while (!stopReading) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r/g, "");
          let separatorIndex = buffer.indexOf("\n\n");
          while (separatorIndex !== -1) {
            const event = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            if (event.trim().length > 0) {
              processEvent(event);
            }
            if (stopReading) {
              break;
            }
            separatorIndex = buffer.indexOf("\n\n");
          }
        }
        buffer += decoder.decode();
        if (!stopReading && buffer.trim().length > 0) {
          processEvent(buffer);
        }
        enqueueDone();
        controller.close();
      })().catch((error) => {
        enqueueError({
          type: "server_error",
          code: "internal_error",
          message:
            error instanceof Error ? error.message : "Stream processing failed.",
        });
        enqueueDone();
        controller.close();
      });
    },
  });
}

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ExtractedMessage = {
  content: string | null;
  tool_calls?: ToolCall[];
};

function extractMessageParts(
  parts: AntigravityContentPart[]
): TransformResult<ExtractedMessage> {
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let toolCallIndex = 0;

  for (const part of parts) {
    if (part && typeof part.text === "string") {
      texts.push(part.text);
      continue;
    }
    if (part && part.functionCall && typeof part.functionCall === "object") {
      const call = part.functionCall;
      const name = call.name;
      if (typeof name !== "string" || name.length === 0) {
        return invalidMessage(
          "candidates.content.parts.functionCall.name",
          "Function call name is missing."
        );
      }
      let args = call.args;
      if (args === undefined) {
        args = {};
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        return invalidMessage(
          "candidates.content.parts.functionCall.args",
          "Function call args must be an object."
        );
      }
      let argumentsJson: string;
      try {
        argumentsJson = JSON.stringify(args);
      } catch {
        return invalidMessage(
          "candidates.content.parts.functionCall.args",
          "Function call args must be JSON serializable."
        );
      }
      const id =
        typeof call.id === "string" && call.id.length > 0
          ? call.id
          : `call_${++toolCallIndex}`;
      toolCalls.push({
        id,
        type: "function",
        function: {
          name,
          arguments: argumentsJson,
        },
      });
      continue;
    }
    return unsupportedFeature(
      "candidates.content.parts",
      "Non-text content is not supported yet."
    );
  }
  if (texts.length === 0 && toolCalls.length === 0) {
    return invalidMessage(
      "candidates.content.parts",
      "Candidate content must include text or tool calls."
    );
  }
  const content = texts.length > 0 ? texts.join("") : null;
  if (toolCalls.length === 0) {
    return { ok: true, value: { content } };
  }
  return {
    ok: true,
    value: {
      content,
      tool_calls: toolCalls,
    },
  };
}

type ToolCallDelta = {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
};

type DeltaParts = {
  content?: string;
  tool_calls?: ToolCallDelta[];
};

function extractDeltaParts(
  parts: AntigravityContentPart[],
  nextToolIndex: () => number
): TransformResult<DeltaParts> {
  const texts: string[] = [];
  const toolCalls: ToolCallDelta[] = [];

  for (const part of parts) {
    if (part && typeof part.text === "string") {
      texts.push(part.text);
      continue;
    }
    if (part && part.functionCall && typeof part.functionCall === "object") {
      const call = part.functionCall;
      const name = call.name;
      if (typeof name !== "string" || name.length === 0) {
        return invalidMessage(
          "candidates.content.parts.functionCall.name",
          "Function call name is missing."
        );
      }
      let args = call.args;
      if (args === undefined) {
        args = {};
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        return invalidMessage(
          "candidates.content.parts.functionCall.args",
          "Function call args must be an object."
        );
      }
      let argumentsJson: string;
      try {
        argumentsJson = JSON.stringify(args);
      } catch {
        return invalidMessage(
          "candidates.content.parts.functionCall.args",
          "Function call args must be JSON serializable."
        );
      }
      const index = nextToolIndex();
      const id =
        typeof call.id === "string" && call.id.length > 0
          ? call.id
          : `call_${index + 1}`;
      toolCalls.push({
        index,
        id,
        type: "function",
        function: {
          name,
          arguments: argumentsJson,
        },
      });
      continue;
    }
    return unsupportedFeature(
      "candidates.content.parts",
      "Non-text content is not supported yet."
    );
  }

  if (texts.length === 0 && toolCalls.length === 0) {
    return invalidMessage(
      "candidates.content.parts",
      "Candidate content must include text or tool calls."
    );
  }

  const delta: DeltaParts = {};
  if (texts.length > 0) {
    delta.content = texts.join("");
  }
  if (toolCalls.length > 0) {
    delta.tool_calls = toolCalls;
  }
  return { ok: true, value: delta };
}

function buildChunkFromResponse(
  response: AntigravityResponse,
  requestId: string,
  model: string,
  created: number,
  roleEmitted: Set<number>,
  toolCallIndexByChoice: Map<number, number>
): TransformResult<ChatCompletionChunk> {
  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    return invalidMessage("candidates", "Response candidates are missing.");
  }

  const choices: ChatCompletionChunk["choices"] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const content = candidate.content;
    if (!content || !Array.isArray(content.parts)) {
      return invalidMessage(
        "candidates.content",
        "Candidate content is missing."
      );
    }
    if (content.role && content.role !== "model") {
      return invalidMessage(
        "candidates.content.role",
        "Candidate role must be model."
      );
    }

    const choiceIndex =
      typeof candidate.index === "number" ? candidate.index : index;
    const nextToolIndex = () => {
      const current = toolCallIndexByChoice.get(choiceIndex) ?? 0;
      toolCallIndexByChoice.set(choiceIndex, current + 1);
      return current;
    };
    const deltaResult = extractDeltaParts(content.parts, nextToolIndex);
    if (!deltaResult.ok) {
      return deltaResult;
    }
    const delta = { ...deltaResult.value };
    if (!roleEmitted.has(choiceIndex)) {
      roleEmitted.add(choiceIndex);
      delta.role = "assistant";
    }
    choices.push({
      index: choiceIndex,
      delta,
      finish_reason: mapFinishReason(candidate.finishReason),
    });
  }

  const chunk: ChatCompletionChunk = {
    id: `chatcmpl-${requestId}`,
    object: "chat.completion.chunk",
    created,
    model,
    choices,
  };

  return { ok: true, value: chunk };
}

function mapFinishReason(
  finishReason?: string
): "stop" | "length" | null {
  if (!finishReason) {
    return null;
  }
  const normalized = finishReason.toUpperCase();
  if (normalized === "STOP") {
    return "stop";
  }
  if (normalized === "MAX_TOKENS") {
    return "length";
  }
  return null;
}

function buildUsage(
  metadata?: AntigravityUsageMetadata
): ChatCompletionResponse["usage"] | undefined {
  if (!metadata) {
    return undefined;
  }
  const { promptTokenCount, candidatesTokenCount, totalTokenCount } = metadata;
  if (
    typeof promptTokenCount !== "number" ||
    typeof candidatesTokenCount !== "number" ||
    typeof totalTokenCount !== "number"
  ) {
    return undefined;
  }
  return {
    prompt_tokens: promptTokenCount,
    completion_tokens: candidatesTokenCount,
    total_tokens: totalTokenCount,
  };
}

function extractSseData(event: string): string | null {
  const lines = event.split("\n");
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join("\n");
}

function extractUpstreamError(
  payload: unknown
): { type: string; code: string; message: string } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (!("error" in payload)) {
    return null;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return {
      type: "upstream_error",
      code: "upstream_error",
      message: "Upstream error.",
    };
  }
  const message =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "Upstream error.";
  return {
    type: "upstream_error",
    code: "upstream_error",
    message,
  };
}

function extractResponsePayload(payload: unknown): AntigravityResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if ("response" in payload) {
    const response = (payload as { response?: unknown }).response;
    if (response && typeof response === "object") {
      return response as AntigravityResponse;
    }
  }
  if ("candidates" in payload || "usageMetadata" in payload) {
    return payload as AntigravityResponse;
  }
  return null;
}

function mapTransformError(error: TransformError): {
  type: string;
  code: string;
  message: string;
} {
  switch (error.code) {
    case "INVALID_MESSAGE_FORMAT":
      return {
        type: "invalid_request_error",
        code: "invalid_request",
        message: error.message,
      };
    case "UNSUPPORTED_FEATURE":
      return {
        type: "invalid_request_error",
        code: "unsupported_parameter",
        message: error.message,
      };
    case "SIGNATURE_CACHE_MISS":
      return {
        type: "invalid_request_error",
        code: "signature_required",
        message: error.message,
      };
  }
}

function unsupportedFeature(field: string, message: string): TransformResult<never> {
  return { ok: false, error: { code: "UNSUPPORTED_FEATURE", message, field } };
}

function invalidMessage(field: string, message: string): TransformResult<never> {
  return { ok: false, error: { code: "INVALID_MESSAGE_FORMAT", message, field } };
}
