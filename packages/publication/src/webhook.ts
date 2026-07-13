import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyWebhookOptions {
  secret: string;
  rawBody: Uint8Array;
  signatureHeader: string | undefined;
}

export function verifyGithubWebhookSignature(options: VerifyWebhookOptions): boolean {
  if (!options.signatureHeader?.startsWith('sha256=')) return false;
  const suppliedHex = options.signatureHeader.slice('sha256='.length);
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return false;
  const expected = createHmac('sha256', options.secret).update(options.rawBody).digest();
  const supplied = Buffer.from(suppliedHex, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export class WebhookReplayGuard {
  private readonly seen = new Map<string, number>();
  constructor(
    private readonly replayWindowSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}
  accept(deliveryId: string): boolean {
    if (!/^[A-Za-z0-9-]{8,128}$/.test(deliveryId)) return false;
    const current = this.now();
    const cutoff = current - this.replayWindowSeconds * 1000;
    for (const [id, timestamp] of this.seen) if (timestamp < cutoff) this.seen.delete(id);
    if (this.seen.has(deliveryId)) return false;
    this.seen.set(deliveryId, current);
    return true;
  }
}
