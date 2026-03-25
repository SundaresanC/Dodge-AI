/**
 * AI provider factory.
 *
 * Returns a unified `generate(prompt: string) => Promise<string>` function
 * regardless of which provider/model is selected.
 *
 * Key resolution order:
 *   1. Caller-supplied apiKey (from a decrypted AIModelConfig row)
 *   2. System environment variable (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY)
 */

import { env } from "../config.js";

export type AIProvider = "GEMINI" | "OPENAI" | "ANTHROPIC";

export interface ProviderOptions {
  provider: AIProvider;
  modelId: string;
  /** Pre-decrypted API key from the user's AIModelConfig. Falls back to env if omitted. */
  apiKey?: string | null;
}

export type GenerateFn = (prompt: string) => Promise<string>;

/**
 * Returns a generate function for the specified provider/model.
 * Throws if no API key is available for the requested provider.
 */
export async function getAIGenerateFn(opts: ProviderOptions): Promise<GenerateFn> {
  const { provider, modelId, apiKey } = opts;

  switch (provider) {
    case "GEMINI":
      return buildGeminiFn(modelId, apiKey ?? env.GEMINI_API_KEY ?? null);
    case "OPENAI":
      return buildOpenAIFn(modelId, apiKey ?? env.OPENAI_API_KEY ?? null);
    case "ANTHROPIC":
      return buildAnthropicFn(modelId, apiKey ?? env.ANTHROPIC_API_KEY ?? null);
    default: {
      const _exhaust: never = provider;
      throw new Error(`Unknown AI provider: ${String(_exhaust)}`);
    }
  }
}

/**
 * Returns the first available provider+model pair based on system env keys,
 * falling back through Gemini → OpenAI → Anthropic.
 */
export function getSystemDefaultProvider(): {
  provider: AIProvider;
  modelId: string;
} | null {
  if (env.GEMINI_API_KEY) return { provider: "GEMINI", modelId: env.GEMINI_MODEL };
  if (env.OPENAI_API_KEY) return { provider: "OPENAI", modelId: "gpt-4o-mini" };
  if (env.ANTHROPIC_API_KEY) return { provider: "ANTHROPIC", modelId: "claude-3-haiku-20240307" };
  return null;
}

// ─── Provider builders ───────────────────────────────────

async function buildGeminiFn(
  modelId: string,
  apiKey: string | null
): Promise<GenerateFn> {
  if (!apiKey) {
    throw new Error(
      "No Gemini API key available. Add one in Settings → AI Models or set GEMINI_API_KEY in .env"
    );
  }
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey });

  return async (prompt: string): Promise<string> => {
    const response = await client.models.generateContent({
      model: modelId,
      contents: prompt,
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned an empty response");
    return text;
  };
}

async function buildOpenAIFn(
  modelId: string,
  apiKey: string | null
): Promise<GenerateFn> {
  if (!apiKey) {
    throw new Error(
      "No OpenAI API key available. Add one in Settings → AI Models or set OPENAI_API_KEY in .env"
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OpenAI = ((await import("openai" as string)) as any).default;
  const client = new OpenAI({ apiKey }) as {
    chat: {
      completions: {
        create(params: object): Promise<{
          choices: { message: { content: string | null } }[];
        }>;
      };
    };
  };

  return async (prompt: string): Promise<string> => {
    const res = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned an empty response");
    return content;
  };
}

async function buildAnthropicFn(
  modelId: string,
  apiKey: string | null
): Promise<GenerateFn> {
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key available. Add one in Settings → AI Models or set ANTHROPIC_API_KEY in .env"
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import("@anthropic-ai/sdk" as string)) as any;
  const AnthropicClass = mod.default ?? mod.Anthropic ?? mod;
  const client = new AnthropicClass({ apiKey }) as {
    messages: {
      create(params: object): Promise<{
        content: { type: string; text: string }[];
      }>;
    };
  };

  return async (prompt: string): Promise<string> => {
    const message = await client.messages.create({
      model: modelId,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    if (!block || block.type !== "text") {
      throw new Error("Anthropic returned an unexpected response format");
    }
    return block.text;
  };
}


