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
  functionCall?: Record<string, unknown>;
  functionResponse?: Record<string, unknown>;
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

    const textResult = extractText(content.parts);
    if (!textResult.ok) {
      return textResult;
    }

    const choiceIndex =
      typeof candidate.index === "number" ? candidate.index : index;
    choices.push({
      index: choiceIndex,
      message: {
        role: "assistant",
        content: textResult.value,
      },
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

function extractText(
  parts: AntigravityContentPart[]
): TransformResult<string> {
  const texts: string[] = [];
  for (const part of parts) {
    if (part && typeof part.text === "string") {
      texts.push(part.text);
      continue;
    }
    return unsupportedFeature(
      "candidates.content.parts",
      "Non-text content is not supported yet."
    );
  }
  if (texts.length === 0) {
    return invalidMessage(
      "candidates.content.parts",
      "Candidate content must include text."
    );
  }
  return { ok: true, value: texts.join("") };
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

function unsupportedFeature(field: string, message: string): TransformResult<never> {
  return { ok: false, error: { code: "UNSUPPORTED_FEATURE", message, field } };
}

function invalidMessage(field: string, message: string): TransformResult<never> {
  return { ok: false, error: { code: "INVALID_MESSAGE_FORMAT", message, field } };
}
