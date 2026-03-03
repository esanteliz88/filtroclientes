import type { App } from '../app.js';

type MatchWebhookPayload = Record<string, unknown>;

const DEFAULT_WEBHOOK_URL = 'https://n8n.miotraopcion.cl/webhook/sendmail';

export async function sendMatchWebhook(app: App, payload: MatchWebhookPayload) {
  const url = process.env.N8N_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      app.log.warn(
        { status: response.status, body: text.slice(0, 500) },
        'n8n webhook failed'
      );
    }
  } catch (error) {
    app.log.warn({ err: error }, 'n8n webhook error');
  } finally {
    clearTimeout(timeout);
  }
}
