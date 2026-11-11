import express, { Router } from 'express';
import { applyEvent, hashBody } from './events';
import type { Payments } from './routes';

/** Provider callbacks. No session or cookie: the signature on the raw body is the only proof, and it is checked before anything is read. */
export const webhooksRouter = (payments: Payments) => {
  const router = Router();
  for (const name of ['razorpay', 'stripe'] as const) {
    router.post(`/${name}`, express.raw({ type: '*/*', limit: '64kb' }), async (req, res) => {
      const provider = payments.providers[name];
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const event = provider?.verifyWebhook(rawBody, req.headers) ?? null;
      if (!event) return res.status(400).json({ error: 'Bad signature' });
      try {
        const outcome = await applyEvent(payments, name, event, hashBody(rawBody));
        // A 5xx makes the provider send it again, which is what an order we cannot match yet needs.
        res.status(outcome === 'unknown-order' ? 503 : 200).json({ ok: outcome !== 'unknown-order' });
      } catch (error) {
        console.error('Webhook failed', error instanceof Error ? error.message : 'unknown');
        res.status(500).json({ error: 'Try again' });
      }
    });
  }
  return router;
};
