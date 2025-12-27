import { z } from "zod";

const TextContentPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const UserContentSchema = z
  .union([z.string(), z.array(TextContentPartSchema)])
  .transform((value) => {
    if (typeof value === "string") {
      return value;
    }
    return value.map((part) => part.text).join("");
  });

const SystemMessageSchema = z.object({
  role: z.literal("system"),
  content: z.string(),
});

const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: UserContentSchema,
});

const AssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          arguments: z.string(),
        }),
      })
    )
    .optional(),
});

const ToolMessageSchema = z.object({
  role: z.literal("tool"),
  tool_call_id: z.string(),
  content: z.string(),
});

const ChatCompletionMessageSchema = z.discriminatedUnion("role", [
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

export const ChatCompletionRequestSchema = z
  .object({
    model: z.string(),
    messages: z.array(ChatCompletionMessageSchema),
    tools: z
      .array(
        z.object({
          type: z.literal("function"),
          function: z.object({
            name: z.string(),
            description: z.string().optional(),
            parameters: z.record(z.unknown()).optional(),
          }),
        })
      )
      .optional(),
    tool_choice: z
      .union([
        z.literal("auto"),
        z.object({
          type: z.literal("function"),
          function: z.object({ name: z.string() }),
        }),
      ])
      .optional(),
    stream: z.boolean().optional().default(false),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().positive().optional(),
    n: z.number().int().min(1).max(1).optional(),
    logprobs: z.never().optional(),
  })
  .strict();

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
