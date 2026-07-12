import { z, type ZodType } from 'zod';
import { sha256Hex, redactSecretsFromValue } from '@codeer/security';
import type { AiProvider, InvestigationAgentKind } from '@codeer/contracts';

export interface StructuredModelRequest<T> {
  provider: AiProvider;
  model: string;
  agent: InvestigationAgentKind;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  validator: ZodType<T>;
  maximumOutputTokens: number;
  timeoutMs: number;
  metadata: Record<string, string>;
  safetyIdentifier: string;
  store: boolean;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

export interface StructuredModelResult<T> {
  providerRequestId: string;
  providerResponseId: string;
  model: string;
  output: T;
  outputHash: string;
  usage: ModelUsage;
  durationMs: number;
  rawStatus: string;
}

export interface ModelGateway {
  generateStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>>;
  cancel(providerResponseId: string): Promise<void>;
}

const OpenAIResponseSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  model: z.string().min(1),
  output: z
    .array(
      z.object({
        type: z.string(),
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      }),
    )
    .default([]),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().default(0),
      output_tokens: z.number().int().nonnegative().default(0),
      input_tokens_details: z
        .object({ cached_tokens: z.number().int().nonnegative().default(0) })
        .optional(),
      output_tokens_details: z
        .object({ reasoning_tokens: z.number().int().nonnegative().default(0) })
        .optional(),
    })
    .optional(),
});

function extractOutputText(output: z.infer<typeof OpenAIResponseSchema>['output']): string {
  return output
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text ?? '')
    .join('');
}

export interface OpenAIResponsesGatewayOptions {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  fetchImplementation?: typeof fetch;
}

export class OpenAIResponsesGateway implements ModelGateway {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: OpenAIResponsesGatewayOptions) {
    if (options.apiKey.length < 20) throw new Error('OpenAI API key is not configured.');
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async generateStructured<T>(
    request: StructuredModelRequest<T>,
  ): Promise<StructuredModelResult<T>> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    const requestId = crypto.randomUUID();
    try {
      const response = await this.fetchImplementation(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          'x-client-request-id': requestId,
          ...(this.options.organization
            ? { 'openai-organization': this.options.organization }
            : {}),
          ...(this.options.project ? { 'openai-project': this.options.project } : {}),
        },
        body: JSON.stringify({
          model: request.model,
          instructions: request.instructions,
          input: request.input,
          max_output_tokens: request.maximumOutputTokens,
          store: request.store,
          parallel_tool_calls: false,
          metadata: request.metadata,
          safety_identifier: request.safetyIdentifier,
          text: {
            format: {
              type: 'json_schema',
              name: request.schemaName,
              strict: true,
              schema: request.schema,
            },
          },
        }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const safe = redactSecretsFromValue(payload).value;
        throw new Error(
          `OpenAI Responses API failed with ${response.status}: ${JSON.stringify(safe).slice(0, 1_000)}`,
        );
      }
      const parsedResponse = OpenAIResponseSchema.parse(payload);
      const text = extractOutputText(parsedResponse.output);
      if (!text) throw new Error('OpenAI response did not contain structured output text.');
      const decoded: unknown = JSON.parse(text);
      const structured = request.validator.parse(decoded);
      const usage = parsedResponse.usage;
      return {
        providerRequestId: requestId,
        providerResponseId: parsedResponse.id,
        model: parsedResponse.model,
        output: structured,
        outputHash: sha256Hex(JSON.stringify(structured)),
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
          reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
        },
        durationMs: Date.now() - started,
        rawStatus: parsedResponse.status,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async cancel(providerResponseId: string): Promise<void> {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/responses/${encodeURIComponent(providerResponseId)}/cancel`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}` },
      },
    );
    if (!response.ok && response.status !== 404 && response.status !== 409) {
      throw new Error(`Unable to cancel provider response (${response.status}).`);
    }
  }
}

export class DeterministicModelGateway implements ModelGateway {
  constructor(private readonly outputs: Map<string, unknown>) {}

  generateStructured<T>(request: StructuredModelRequest<T>): Promise<StructuredModelResult<T>> {
    const value = this.outputs.get(request.schemaName);
    if (value === undefined) {
      return Promise.reject(new Error(`No deterministic output for ${request.schemaName}.`));
    }
    const output = request.validator.parse(value);
    return Promise.resolve({
      providerRequestId: crypto.randomUUID(),
      providerResponseId: `test-${crypto.randomUUID()}`,
      model: request.model,
      output,
      outputHash: sha256Hex(JSON.stringify(output)),
      usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, reasoningTokens: 0 },
      durationMs: 1,
      rawStatus: 'completed',
    });
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }
}
