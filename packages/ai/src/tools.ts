import { ToolCallStatus, type AiPolicy, type InvestigationAgentKind } from '@codeer/contracts';
import { sha256Hex, redactSecretsFromValue } from '@codeer/security';
import { assertAgentToolAllowed } from './policy.js';

export interface ToolCallContext {
  organizationId: string;
  incidentId: string;
  investigationId: string;
  agentKind: InvestigationAgentKind;
  correlationId: string;
  leaseOwner: string;
}

export interface ToolCallAudit {
  id: string;
  toolName: string;
  status: ToolCallStatus;
  inputHash: string;
  outputHash: string | null;
  durationMs: number;
  deniedReason: string | null;
}

export type ReadOnlyToolHandler = (
  context: ToolCallContext,
  input: Record<string, unknown>,
) => Promise<unknown>;

export class ReadOnlyToolGateway {
  private readonly handlers = new Map<string, ReadOnlyToolHandler>();

  register(name: string, handler: ReadOnlyToolHandler): this {
    if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(name)) throw new Error(`Invalid tool name: ${name}`);
    if (this.handlers.has(name)) throw new Error(`Tool is already registered: ${name}`);
    this.handlers.set(name, handler);
    return this;
  }

  async execute(
    policy: AiPolicy,
    context: ToolCallContext,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ output: unknown; audit: ToolCallAudit }> {
    const started = Date.now();
    const id = crypto.randomUUID();
    const redactedInput = redactSecretsFromValue(input);
    const inputHash = sha256Hex(JSON.stringify(redactedInput.value));
    try {
      assertAgentToolAllowed(policy, context.agentKind, toolName);
      const handler = this.handlers.get(toolName);
      if (!handler) throw new Error(`Tool is not registered: ${toolName}`);
      const output = redactSecretsFromValue(await handler(context, redactedInput.value));
      const serialized = JSON.stringify(output.value);
      if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) {
        throw new Error('Tool output exceeded the two megabyte boundary.');
      }
      return {
        output: output.value,
        audit: {
          id,
          toolName,
          status: ToolCallStatus.COMPLETED,
          inputHash,
          outputHash: sha256Hex(serialized),
          durationMs: Date.now() - started,
          deniedReason: null,
        },
      };
    } catch (error) {
      const denied = error instanceof Error ? error.message : 'Tool call failed.';
      const isDenied = /not authorized|not registered|exceeded/i.test(denied);
      throw Object.assign(new Error(denied), {
        audit: {
          id,
          toolName,
          status: isDenied ? ToolCallStatus.DENIED : ToolCallStatus.FAILED,
          inputHash,
          outputHash: null,
          durationMs: Date.now() - started,
          deniedReason: denied.slice(0, 2_000),
        } satisfies ToolCallAudit,
      });
    }
  }
}
