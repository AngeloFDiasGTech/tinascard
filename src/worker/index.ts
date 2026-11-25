import { Hono } from 'hono';
import {
  isValidCardCode,
  isValidSlotIndex,
  normalizeCardCode,
  validateCreateCardInput,
  validateSignSlotInput,
} from '../shared/validation';
import {
  acquireSlotLock,
  createCard,
  getCard,
  purgeExpiredCards,
  releaseSlotLock,
  signSlotAtomic,
} from './db';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
}

function getSessionToken(rawHeader: string | undefined | null): string | null {
  if (!rawHeader) return null;
  const trimmed = rawHeader.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injectCardMetaTags(
  html: string,
  title: string,
  description: string,
  url: string,
): string {
  const safeTitle = escapeAttr(title);
  const safeDesc = escapeAttr(description);
  const safeUrl = escapeAttr(url);

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/i,
      `$1${safeDesc}$2`,
    )
    .replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*(")/i,
      `$1${safeTitle}$2`,
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/i,
      `$1${safeDesc}$2`,
    )
    .replace(
      /(<meta\s+property="og:url"\s+content=")[^"]*(")/i,
      `$1${safeUrl}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/i,
      `$1${safeTitle}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/i,
      `$1${safeDesc}$2`,
    );
}

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  // Cabeçalhos de segurança e controle de cache para API
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    c.header('X-Content-Type-Options', 'nosniff');
  });

  app.get('/api/health', (c) => {
    return c.json({ ok: true, service: 'tinascard' });
  });

  // Criar cartão
  app.post('/api/cards', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: 'Corpo da requisição inválido.' }, 400);
    }

    const parsed = validateCreateCardInput(
      (body && typeof body === 'object' ? body : {}) as { name?: unknown; message?: unknown },
    );

    if (!parsed.ok) {
      return c.json({ error: 'VALIDATION_ERROR', message: parsed.error }, 400);
    }

    const card = await createCard(c.env.DB, parsed.name, parsed.message);
    return c.json(card, 201);
  });

  // Visualizar cartão pelo código único
  app.get('/api/cards/:id', async (c) => {
    const code = normalizeCardCode(c.req.param('id'));
    if (!isValidCardCode(code)) {
      return c.json(
        {
          error: 'CARD_NOT_FOUND',
          message: 'Cartão não existe. Verifique o código informado.',
        },
        404,
      );
    }

    const sessionToken = getSessionToken(c.req.header('X-Session-Token'));
    const card = await getCard(c.env.DB, code, sessionToken);

    if (!card) {
      return c.json(
        {
          error: 'CARD_NOT_FOUND',
          message: 'Cartão não existe ou já expirou. Verifique o código informado.',
        },
        404,
      );
    }

    return c.json(card);
  });

  // Adquirir ou renovar reserva temporária (Soft Lock) de um espaço
  app.post('/api/cards/:id/slots/:slotIndex/lock', async (c) => {
    const code = normalizeCardCode(c.req.param('id'));
    const slotIndex = Number(c.req.param('slotIndex'));
    const sessionToken = getSessionToken(c.req.header('X-Session-Token'));

    if (!isValidCardCode(code) || !isValidSlotIndex(slotIndex)) {
      return c.json({ error: 'INVALID_PARAMS', message: 'Cartão ou espaço inválido.' }, 400);
    }

    if (!sessionToken) {
      return c.json(
        { error: 'MISSING_SESSION', message: 'Token de sessão obrigatório para reservar espaço.' },
        400,
      );
    }

    const result = await acquireSlotLock(c.env.DB, code, slotIndex, sessionToken);

    if (!result.ok) {
      if (result.reason === 'card_not_found') {
        return c.json(
          { error: 'CARD_NOT_FOUND', message: 'Cartão não encontrado ou expirado.' },
          404,
        );
      }

      if (result.reason === 'already_signed') {
        return c.json(
          {
            error: 'SLOT_ALREADY_SIGNED',
            message: 'Este espaço acabou de ser assinado por outra pessoa. Escolha outro espaço livre.',
            slots: result.slots,
          },
          409,
        );
      }

      return c.json(
        {
          error: 'SLOT_LOCKED',
          message: 'Outra pessoa está assinando este espaço neste momento. Escolha outro espaço livre.',
          lockExpiresAt: result.lockExpiresAt,
          slots: result.slots,
        },
        409,
      );
    }

    return c.json({ slotIndex, lockExpiresAt: result.lockExpiresAt });
  });

  // Liberar reserva (DELETE e POST /unlock para suportar navigator.sendBeacon)
  const handleUnlock = async (c: {
    req: { param: (k: string) => string; header: (k: string) => string | undefined; text: () => Promise<string> };
    env: Env;
    json: (data: unknown, status?: 200 | 400) => Response;
  }) => {
    const code = normalizeCardCode(c.req.param('id'));
    const slotIndex = Number(c.req.param('slotIndex'));

    let sessionToken = getSessionToken(c.req.header('X-Session-Token'));
    if (!sessionToken) {
      try {
        const text = await c.req.text();
        if (text) {
          const parsed = JSON.parse(text) as { sessionToken?: string };
          sessionToken = getSessionToken(parsed.sessionToken);
        }
      } catch {
        // Ignora corpo inválido em beacon
      }
    }

    if (!isValidCardCode(code) || !isValidSlotIndex(slotIndex) || !sessionToken) {
      return c.json({ ok: false }, 400);
    }

    await releaseSlotLock(c.env.DB, code, slotIndex, sessionToken);
    return c.json({ ok: true });
  };

  app.delete('/api/cards/:id/slots/:slotIndex/lock', (c) => handleUnlock(c));
  app.post('/api/cards/:id/slots/:slotIndex/unlock', (c) => handleUnlock(c));

  // Queimar assinatura no espaço (gravação atômica)
  app.post('/api/cards/:id/slots/:slotIndex/sign', async (c) => {
    const code = normalizeCardCode(c.req.param('id'));
    const slotIndex = Number(c.req.param('slotIndex'));
    const sessionToken = getSessionToken(c.req.header('X-Session-Token'));

    if (!isValidCardCode(code) || !isValidSlotIndex(slotIndex)) {
      return c.json({ error: 'INVALID_PARAMS', message: 'Cartão ou espaço inválido.' }, 400);
    }

    if (!sessionToken) {
      return c.json(
        { error: 'MISSING_SESSION', message: 'Token de sessão obrigatório para salvar assinatura.' },
        400,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'INVALID_JSON', message: 'Corpo da requisição inválido.' }, 400);
    }

    const parsed = validateSignSlotInput(
      (body && typeof body === 'object' ? body : {}) as { imageData?: unknown; altText?: unknown },
    );

    if (!parsed.ok) {
      return c.json({ error: 'VALIDATION_ERROR', message: parsed.error }, 400);
    }

    const result = await signSlotAtomic(
      c.env.DB,
      code,
      slotIndex,
      sessionToken,
      parsed.imageData,
      parsed.altText,
    );

    if (!result.ok) {
      if (result.reason === 'card_not_found') {
        return c.json(
          { error: 'CARD_NOT_FOUND', message: 'Cartão não encontrado ou expirado.' },
          404,
        );
      }

      if (result.reason === 'already_signed') {
        return c.json(
          {
            error: 'SLOT_ALREADY_SIGNED',
            message:
              'Ops! Alguém acabou de salvar uma assinatura neste espaço. Sua assinatura foi preservada — escolha outro espaço livre abaixo.',
            slots: result.slots,
          },
          409,
        );
      }

      return c.json(
        {
          error: 'SLOT_LOCKED',
          message:
            'Sua reserva expirou e outra pessoa está usando este espaço. Sua assinatura foi preservada — escolha outro espaço livre abaixo.',
          slots: result.slots,
        },
        409,
      );
    }

    return c.json(result.card);
  });

  // Metadados Open Graph dinâmicos ao compartilhar link direto de um cartão (/c/:id)
  app.get('/c/:id', async (c) => {
    if (!c.env.ASSETS) {
      return c.notFound();
    }

    const assetUrl = new URL('/index.html', c.req.url);
    const assetRes = await c.env.ASSETS.fetch(new Request(assetUrl.toString()));
    const contentType = assetRes.headers.get('content-type') || '';
    if (!assetRes.ok || !contentType.includes('text/html')) {
      return assetRes;
    }

    const code = normalizeCardCode(c.req.param('id'));
    if (!isValidCardCode(code)) {
      return assetRes;
    }

    const card = await getCard(c.env.DB, code, null);
    if (!card) {
      return assetRes;
    }

    const html = await assetRes.text();
    const ogTitle = `Assine o cartão: ${card.name} — Tinas Card`;
    const ogDesc = card.message.replace(/\s+/g, ' ').trim();
    const canonicalUrl = `${new URL(c.req.url).origin}/c/${card.id}`;
    const updatedHtml = injectCardMetaTags(html, ogTitle, ogDesc, canonicalUrl);

    const headers = new Headers(assetRes.headers);
    headers.delete('content-length');
    headers.set('content-type', 'text/html; charset=UTF-8');
    return new Response(updatedHtml, { status: 200, headers });
  });

  // Fallback para assets estáticos / SPA
  app.all('*', async (c) => {
    if (c.env.ASSETS) {
      return c.env.ASSETS.fetch(c.req.raw);
    }
    return c.notFound();
  });

  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purgeExpiredCards(env.DB));
  },
};
