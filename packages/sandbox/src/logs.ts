import { randomUUID } from 'node:crypto';
import { SandboxLogChunkSchema, type SandboxLogChunk } from '@codeer/contracts';
import { redactSecretsFromText, sha256Hex } from '@codeer/security';

export interface LogAccumulatorOptions {
  executionId: string;
  maximumBytes: number;
  maximumChunkBytes?: number;
}

function takeUtf8Prefix(
  value: string,
  maximumBytes: number,
): { content: string; consumed: number } {
  if (maximumBytes <= 0 || value.length === 0) return { content: '', consumed: 0 };
  let bytes = 0;
  let consumed = 0;
  let content = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maximumBytes) break;
    content += character;
    bytes += characterBytes;
    consumed += character.length;
  }
  return { content, consumed };
}

export class SandboxLogAccumulator {
  private sequence = 0;
  private totalBytes = 0;
  private previousHash: string | null = null;
  private readonly maximumChunkBytes: number;
  private truncated = false;

  constructor(private readonly options: LogAccumulatorOptions) {
    this.maximumChunkBytes = Math.min(
      Math.max(options.maximumChunkBytes ?? 32 * 1024, 1024),
      128 * 1024,
    );
  }

  append(
    stream: 'stdout' | 'stderr' | 'system',
    rawContent: string,
    commandId: string | null,
    occurredAt = new Date(),
  ): SandboxLogChunk[] {
    if (this.totalBytes >= this.options.maximumBytes) {
      this.truncated = true;
      return [];
    }
    const redaction = redactSecretsFromText(rawContent);
    const chunks: SandboxLogChunk[] = [];
    let offset = 0;
    while (offset < redaction.value.length && this.totalBytes < this.options.maximumBytes) {
      const remainingBudget = this.options.maximumBytes - this.totalBytes;
      const { content, consumed } = takeUtf8Prefix(
        redaction.value.slice(offset),
        Math.min(this.maximumChunkBytes, remainingBudget),
      );
      if (!content || consumed === 0) {
        this.truncated = true;
        break;
      }
      const byteSize = Buffer.byteLength(content, 'utf8');
      offset += consumed;
      this.sequence += 1;
      const truncated =
        offset < redaction.value.length || this.totalBytes + byteSize >= this.options.maximumBytes;
      const chunkHash = sha256Hex(
        JSON.stringify({
          executionId: this.options.executionId,
          commandId,
          sequence: this.sequence,
          stream,
          content,
          previousHash: this.previousHash,
          occurredAt: occurredAt.toISOString(),
        }),
      );
      const chunk = SandboxLogChunkSchema.parse({
        id: randomUUID(),
        executionId: this.options.executionId,
        commandId,
        sequence: this.sequence,
        stream,
        content,
        byteSize,
        redacted: redaction.redacted,
        redactionCount: redaction.count,
        truncated,
        previousHash: this.previousHash,
        chunkHash,
        occurredAt: occurredAt.toISOString(),
      });
      chunks.push(chunk);
      this.previousHash = chunkHash;
      this.totalBytes += byteSize;
      if (truncated && this.totalBytes >= this.options.maximumBytes) this.truncated = true;
    }
    if (offset < redaction.value.length) this.truncated = true;
    return chunks;
  }

  summary(): { chunks: number; bytes: number; headHash: string | null; truncated: boolean } {
    return {
      chunks: this.sequence,
      bytes: this.totalBytes,
      headHash: this.previousHash,
      truncated: this.truncated,
    };
  }
}
