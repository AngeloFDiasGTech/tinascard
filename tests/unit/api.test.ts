import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorResponse, CardData } from '../../src/shared/types';
import {
  acquireSlotLock,
  createCard,
  getCard,
  purgeExpiredCards,
  resetSchemaCacheForTests,
  signSlotAtomic,
} from '../../src/worker/db';
import { createApp, type Env } from '../../src/worker/index';

/**
 * Adapter fiel de D1Database apoiado em SQLite real (node:sqlite do Node 24)
 * para testar queries SQL, constraints e concorrência de verdade.
 */
function createInMemoryD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  const createPrepared = (sql: string, params: unknown[] = []): D1PreparedStatement => {
    const stmt: Partial<D1PreparedStatement> = {
      bind(...values: unknown[]) {
        return createPrepared(sql, values);
      },
      async first<T = unknown>() {
        const prepared = sqlite.prepare(sql);
        const row = prepared.get(...(params as never[])) as T | undefined;
        return row ?? null;
      },
      async all<T = unknown>() {
        const prepared = sqlite.prepare(sql);
        const results = prepared.all(...(params as never[])) as T[];
        return {
          results,
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: results.length,
            rows_written: 0,
            last_row_id: 0,
            changed_db: false,
            changes: 0,
          },
        } as D1Result<T>;
      },
      async run<T = Record<string, unknown>>() {
        const prepared = sqlite.prepare(sql);
        const info = prepared.run(...(params as never[]));
        return {
          results: [] as T[],
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid ?? 0),
            changed_db: Number(info.changes) > 0,
            changes: Number(info.changes),
          },
        } as D1Result<T>;
      },
    };
    return stmt as D1PreparedStatement;
  };

  return {
    prepare(sql: string) {
      return createPrepared(sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      const results = [];
      for (const s of statements) {
        results.push(await s.run());
      }
      return results;
    },
  } as unknown as D1Database;
}

const SAMPLE_PNG = `data:image/png;base64,${'A'.repeat(240)}`;

describe('API e Concorrência do Tinas Card (D1 / SQLite real)', () => {
  let db: D1Database;
  let env: Env;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetSchemaCacheForTests();
    db = createInMemoryD1();
    env = { DB: db };
    app = createApp();
  });

  it('cria cartão com 24 espaços livres e validade de 45 dias, e permite consultar por ID', async () => {
    const createRes = await app.fetch(
      new Request('http://localhost/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Cartão de Tina',
          message: 'Seja bem-vinda, Tina! Estamos felizes com sua chegada.',
        }),
      }),
      env,
    );

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as CardData;
    expect(created.id).toHaveLength(6);
    expect(created.name).toBe('Cartão de Tina');
    expect(created.slots).toHaveLength(24);
    expect(created.slots.every((s) => s.status === 'empty')).toBe(true);

    const diffDays = Math.round(
      (new Date(created.expiresAt).getTime() - new Date(created.createdAt).getTime()) /
        (24 * 60 * 60 * 1000),
    );
    expect(diffDays).toBe(45);

    const getRes = await app.fetch(
      new Request(`http://localhost/api/cards/${created.id.toLowerCase()}`),
      env,
    );
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as CardData;
    expect(fetched.id).toBe(created.id);
  });

  it('retorna 404 amigável quando o cartão não existe', async () => {
    const res = await app.fetch(new Request('http://localhost/api/cards/ZZZZ99'), env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiErrorResponse;
    expect(body.error).toBe('CARD_NOT_FOUND');
  });

  it('protege contra concorrência via Soft Lock (impede segundo usuário de abrir espaço reservado)', async () => {
    const card = await createCard(db, 'Festa 15 Anos', 'Parabéns!');

    // Usuário A reserva o espaço 0
    const lockA = await app.fetch(
      new Request(`http://localhost/api/cards/${card.id}/slots/0/lock`, {
        method: 'POST',
        headers: { 'X-Session-Token': 'session_user_A_1234' },
      }),
      env,
    );
    expect(lockA.status).toBe(200);

    // Usuário B tenta reservar o mesmo espaço 0 -> 409 SLOT_LOCKED
    const lockB = await app.fetch(
      new Request(`http://localhost/api/cards/${card.id}/slots/0/lock`, {
        method: 'POST',
        headers: { 'X-Session-Token': 'session_user_B_5678' },
      }),
      env,
    );
    expect(lockB.status).toBe(409);
    const lockBBody = (await lockB.json()) as ApiErrorResponse;
    expect(lockBBody.error).toBe('SLOT_LOCKED');
    expect(lockBBody.slots?.[0].status).toBe('locked');
    expect(lockBBody.slots?.[0].lockedByMe).toBe(false);

    // Usuário A libera a reserva
    const unlockA = await app.fetch(
      new Request(`http://localhost/api/cards/${card.id}/slots/0/lock`, {
        method: 'DELETE',
        headers: { 'X-Session-Token': 'session_user_A_1234' },
      }),
      env,
    );
    expect(unlockA.status).toBe(200);

    // Agora Usuário B consegue reservar
    const lockBRetry = await app.fetch(
      new Request(`http://localhost/api/cards/${card.id}/slots/0/lock`, {
        method: 'POST',
        headers: { 'X-Session-Token': 'session_user_B_5678' },
      }),
      env,
    );
    expect(lockBRetry.status).toBe(200);
  });

  it('garante atomicidade no salvamento (Hard Lock) e impede sobrescrita de assinatura queimada', async () => {
    const card = await createCard(db, 'Casamento Ana e Lucas', 'Felicidades ao casal!');
    const imgA = `data:image/png;base64,${'A'.repeat(240)}`;
    const imgB = `data:image/png;base64,${'B'.repeat(240)}`;

    // Usuário A reserva e salva no espaço 3
    await acquireSlotLock(db, card.id, 3, 'session_user_A_1234');
    const signA = await app.fetch(
      new Request(`http://localhost/api/cards/${card.id}/slots/3/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': 'session_user_A_1234',
        },
        body: JSON.stringify({ imageData: imgA, altText: 'Maria Silva' }),
      }),
      env,
    );
    expect(signA.status).toBe(200);

    // Usuário B tenta salvar no mesmo espaço 3 -> 409 SLOT_ALREADY_SIGNED com slots atualizados
    const signB = await app.fetch(
      new Request(`http://localhost/api/cards/${card.id}/slots/3/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': 'session_user_B_5678',
        },
        body: JSON.stringify({ imageData: imgB, altText: 'João Pereira' }),
      }),
      env,
    );
    expect(signB.status).toBe(409);
    const conflict = (await signB.json()) as ApiErrorResponse;
    expect(conflict.error).toBe('SLOT_ALREADY_SIGNED');
    expect(conflict.slots?.[3].status).toBe('signed');
    expect(conflict.slots?.[3].imageData).toBe(imgA);
    expect(conflict.slots?.[3].altText).toBe('Maria Silva');
  });

  it('libera automaticamente reserva expirada após 3 minutos e permite outro assinante usar', async () => {
    const t0 = new Date('2026-06-01T12:00:00.000Z');
    const card = await createCard(db, 'Chá de Bebê', 'Bem-vindo!', t0);

    const lockA = await acquireSlotLock(db, card.id, 5, 'session_user_A_1234', t0);
    expect(lockA.ok).toBe(true);

    // 4 minutos depois, lock de A expirou -> B consegue reservar e salvar
    const tLater = new Date(t0.getTime() + 4 * 60 * 1000);
    const lockB = await acquireSlotLock(db, card.id, 5, 'session_user_B_5678', tLater);
    expect(lockB.ok).toBe(true);

    const signB = await signSlotAtomic(
      db,
      card.id,
      5,
      'session_user_B_5678',
      SAMPLE_PNG,
      'Carlos Souza',
      tLater,
    );
    expect(signB.ok).toBe(true);

    // A tenta salvar depois -> bloqueado (já assinado)
    const signALate = await signSlotAtomic(
      db,
      card.id,
      5,
      'session_user_A_1234',
      SAMPLE_PNG,
      'Ana',
      tLater,
    );
    expect(signALate.ok).toBe(false);
    if (!signALate.ok) {
      expect(signALate.reason).toBe('already_signed');
    }
  });

  it('injeta metadados Open Graph dinâmicos ao acessar /c/:id para prévia em WhatsApp e Teams', async () => {
    const card = await createCard(db, 'Chá de Fralda de Tina', 'Que a chegada seja leve!');
    const fakeIndexHtml = `<!DOCTYPE html><html><head>
      <title>Tinas Card</title>
      <meta name="description" content="Desc" />
      <meta property="og:url" content="https://tinascard.angelofdiasg.tech/" />
      <meta property="og:title" content="Tinas Card" />
      <meta property="og:description" content="Desc" />
      <meta property="og:image" content="https://tinascard.angelofdiasg.tech/og-image.png" />
      <meta name="twitter:title" content="Tinas Card" />
      <meta name="twitter:description" content="Desc" />
    </head><body></body></html>`;

    const envWithAssets: Env = {
      DB: db,
      ASSETS: {
        async fetch() {
          return new Response(fakeIndexHtml, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=UTF-8' },
          });
        },
      } as unknown as Fetcher,
    };

    const res = await app.fetch(
      new Request(`https://tinascard.angelofdiasg.tech/c/${card.id}`),
      envWithAssets,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('property="og:title" content="Assine o cartão: Chá de Fralda de Tina — Tinas Card"');
    expect(html).toContain('property="og:description" content="Que a chegada seja leve!"');
    expect(html).toContain(`property="og:url" content="https://tinascard.angelofdiasg.tech/c/${card.id}"`);
    expect(html).toContain('property="og:image" content="https://tinascard.angelofdiasg.tech/og-image.png"');
  });

  it('oculta e expurga cartões após 45 dias', async () => {
    const t0 = new Date('2026-01-01T10:00:00.000Z');
    const card = await createCard(db, 'Cartão Temporário', 'Mensagem', t0);

    // Dia 44 -> ainda existe
    const day44 = new Date(t0.getTime() + 44 * 24 * 60 * 60 * 1000);
    expect(await getCard(db, card.id, null, day44)).not.toBeNull();

    // Dia 46 -> expirado (não retornado e removido pelo cron)
    const day46 = new Date(t0.getTime() + 46 * 24 * 60 * 60 * 1000);
    expect(await getCard(db, card.id, null, day46)).toBeNull();

    const purged = await purgeExpiredCards(db, day46);
    expect(purged).toBe(1);
  });
});
