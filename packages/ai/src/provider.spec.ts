import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiProvider, InvestigationAgentKind } from '@codeer/contracts';
import { OpenAIResponsesGateway, type StructuredModelRequest } from './provider.js';

const OutputSchema = z.object({ answer: z.string() });

function request(): StructuredModelRequest<z.infer<typeof OutputSchema>> {
  return {
    provider: AiProvider.OPENAI,
    model: 'gpt-5.6',
    agent: InvestigationAgentKind.TRIAGE,
    instructions: 'Return a bounded evidence summary.',
    input: 'untrusted evidence',
    schemaName: 'codeer_test_output',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
    validator: OutputSchema,
    maximumOutputTokens: 512,
    timeoutMs: 5_000,
    metadata: { investigation_id: 'test' },
    safetyIdentifier: 'organization:test',
    store: false,
  };
}

describe('OpenAI Responses gateway', () => {
  it('uses strict structured output and never places the API key in the request body', async () => {
    const apiKey = 'test-openai-provider-key-abcdefghijklmnopqrstuvwxyz';
    const fetchImplementation = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
      const body = init.body;
      expect(body).not.toContain(apiKey);
      expect(init.headers).toMatchObject({ authorization: `Bearer ${apiKey}` });
      const parsed: unknown = JSON.parse(body);
      expect(parsed).toMatchObject({
        store: false,
        parallel_tool_calls: false,
        text: {
          format: { type: 'json_schema', name: 'codeer_test_output', strict: true },
        },
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'resp_test',
            status: 'completed',
            model: 'gpt-5.6',
            output: [
              { type: 'message', content: [{ type: 'output_text', text: '{"answer":"safe"}' }] },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    const gateway = new OpenAIResponsesGateway({ apiKey, fetchImplementation });
    const result = await gateway.generateStructured(request());
    expect(result.output).toEqual({ answer: 'safe' });
    expect(result.outputHash).toHaveLength(64);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('redacts provider error payloads before raising them', async () => {
    const apiKey = 'test-openai-provider-key-abcdefghijklmnopqrstuvwxyz';
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: 'authorization: Bearer secret-value-abcdefghijklmnopqrstuvwxyz',
              api_key: apiKey,
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const gateway = new OpenAIResponsesGateway({ apiKey, fetchImplementation });
    let message = '';
    try {
      await gateway.generateStructured(request());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('[REDACTED]');
    expect(message).not.toContain(apiKey);
  });

  it('rejects malformed structured output', async () => {
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'resp_test',
            status: 'completed',
            model: 'gpt-5.6',
            output: [
              { type: 'message', content: [{ type: 'output_text', text: '{"unexpected":true}' }] },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const gateway = new OpenAIResponsesGateway({
      apiKey: 'test-openai-provider-key-abcdefghijklmnopqrstuvwxyz',
      fetchImplementation,
    });
    await expect(gateway.generateStructured(request())).rejects.toThrow();
  });
});
