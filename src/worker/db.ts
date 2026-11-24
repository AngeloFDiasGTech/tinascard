import { TOTAL_SLOTS } from '../shared/layout';
import type { CardData, CardSlot } from '../shared/types';
import { CARD_TTL_DAYS, SLOT_LOCK_TTL_SECONDS } from '../shared/validation';
import { generateCardCode } from './codegen';

interface CardRow {
  id: string;
  name: string;
  message: string;
  created_at: string;
  expires_at: string;
}

interface SlotRow {
  card_id: string;
  slot_index: number;
  status: 'empty' | 'signed';
  image_data: string | null;
  alt_text: string | null;
  signed_at: string | null;
  lock_token: string | null;
  lock_expires_at: string | null;
}

let schemaInitialized = false;

export function resetSchemaCacheForTests(): void {
  schemaInitialized = false;
}

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaInitialized) return;

  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cards_expires_at ON cards(expires_at)`),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS slots (
        card_id TEXT NOT NULL,
        slot_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'signed')),
        image_data TEXT,
        alt_text TEXT,
        signed_at TEXT,
        lock_token TEXT,
        lock_expires_at TEXT,
        PRIMARY KEY (card_id, slot_index),
        FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
      )
    `),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_slots_card_status ON slots(card_id, status)`),
  ]);

  schemaInitialized = true;
}

function mapSlotRow(row: SlotRow, sessionToken: string | null, nowIso: string): CardSlot {
  if (row.status === 'signed') {
    return {
      slotIndex: row.slot_index,
      status: 'signed',
      lockedByMe: false,
      lockExpiresAt: null,
      imageData: row.image_data,
      altText: row.alt_text,
      signedAt: row.signed_at,
    };
  }

  const isLocked =
    Boolean(row.lock_token) && Boolean(row.lock_expires_at) && row.lock_expires_at! > nowIso;

  return {
    slotIndex: row.slot_index,
    status: isLocked ? 'locked' : 'empty',
    lockedByMe: isLocked && Boolean(sessionToken) && row.lock_token === sessionToken,
    lockExpiresAt: isLocked ? row.lock_expires_at : null,
    imageData: null,
    altText: null,
    signedAt: null,
  };
}

export async function createCard(
  db: D1Database,
  name: string,
  message: string,
  now = new Date(),
): Promise<CardData> {
  await ensureSchema(db);

  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CARD_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let cardId = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateCardCode();
    const existing = await db
      .prepare('SELECT id FROM cards WHERE id = ?')
      .bind(candidate)
      .first<{ id: string }>();
    if (!existing) {
      cardId = candidate;
      break;
    }
  }

  if (!cardId) {
    throw new Error('Não foi possível gerar um código único para o cartão.');
  }

  const statements: D1PreparedStatement[] = [
    db
      .prepare('INSERT INTO cards (id, name, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(cardId, name, message, createdAt, expiresAt),
  ];

  for (let i = 0; i < TOTAL_SLOTS; i++) {
    statements.push(
      db.prepare("INSERT INTO slots (card_id, slot_index, status) VALUES (?, ?, 'empty')").bind(cardId, i),
    );
  }

  await db.batch(statements);

  const slots: CardSlot[] = Array.from({ length: TOTAL_SLOTS }, (_, slotIndex) => ({
    slotIndex,
    status: 'empty',
    lockedByMe: false,
    lockExpiresAt: null,
    imageData: null,
    altText: null,
    signedAt: null,
  }));

  return {
    id: cardId,
    name,
    message,
    createdAt,
    expiresAt,
    slots,
  };
}

export async function getCard(
  db: D1Database,
  cardId: string,
  sessionToken: string | null,
  now = new Date(),
): Promise<CardData | null> {
  await ensureSchema(db);
  const nowIso = now.toISOString();

  const card = await db
    .prepare('SELECT id, name, message, created_at, expires_at FROM cards WHERE id = ? AND expires_at > ?')
    .bind(cardId, nowIso)
    .first<CardRow>();

  if (!card) {
    return null;
  }

  const { results } = await db
    .prepare(
      `SELECT card_id, slot_index, status, image_data, alt_text, signed_at, lock_token, lock_expires_at
       FROM slots
       WHERE card_id = ?
       ORDER BY slot_index ASC`,
    )
    .bind(cardId)
    .all<SlotRow>();

  return {
    id: card.id,
    name: card.name,
    message: card.message,
    createdAt: card.created_at,
    expiresAt: card.expires_at,
    slots: (results ?? []).map((row) => mapSlotRow(row, sessionToken, nowIso)),
  };
}

export type LockResult =
  | { ok: true; lockExpiresAt: string }
  | { ok: false; reason: 'card_not_found' | 'already_signed' | 'locked_by_other'; lockExpiresAt?: string | null; slots?: CardSlot[] };

export async function acquireSlotLock(
  db: D1Database,
  cardId: string,
  slotIndex: number,
  sessionToken: string,
  now = new Date(),
): Promise<LockResult> {
  await ensureSchema(db);
  const nowIso = now.toISOString();
  const lockExpiresAt = new Date(now.getTime() + SLOT_LOCK_TTL_SECONDS * 1000).toISOString();

  const card = await db
    .prepare('SELECT id FROM cards WHERE id = ? AND expires_at > ?')
    .bind(cardId, nowIso)
    .first<{ id: string }>();

  if (!card) {
    return { ok: false, reason: 'card_not_found' };
  }

  const updateRes = await db
    .prepare(
      `UPDATE slots
       SET lock_token = ?, lock_expires_at = ?
       WHERE card_id = ?
         AND slot_index = ?
         AND status = 'empty'
         AND (lock_token IS NULL OR lock_token = ? OR lock_expires_at <= ?)`,
    )
    .bind(sessionToken, lockExpiresAt, cardId, slotIndex, sessionToken, nowIso)
    .run();

  if ((updateRes.meta?.changes ?? 0) > 0) {
    return { ok: true, lockExpiresAt };
  }

  // Descobre o motivo exato e retorna slots atualizados para a UI reagir imediatamente
  const refreshed = await getCard(db, cardId, sessionToken, now);
  const slot = refreshed?.slots[slotIndex];

  if (!refreshed || !slot) {
    return { ok: false, reason: 'card_not_found' };
  }

  if (slot.status === 'signed') {
    return { ok: false, reason: 'already_signed', slots: refreshed.slots };
  }

  return {
    ok: false,
    reason: 'locked_by_other',
    lockExpiresAt: slot.lockExpiresAt,
    slots: refreshed.slots,
  };
}

export async function releaseSlotLock(
  db: D1Database,
  cardId: string,
  slotIndex: number,
  sessionToken: string,
): Promise<void> {
  await ensureSchema(db);
  await db
    .prepare(
      `UPDATE slots
       SET lock_token = NULL, lock_expires_at = NULL
       WHERE card_id = ? AND slot_index = ? AND status = 'empty' AND lock_token = ?`,
    )
    .bind(cardId, slotIndex, sessionToken)
    .run();
}

export type SignResult =
  | { ok: true; card: CardData }
  | { ok: false; reason: 'card_not_found' | 'already_signed' | 'locked_by_other'; slots?: CardSlot[] };

export async function signSlotAtomic(
  db: D1Database,
  cardId: string,
  slotIndex: number,
  sessionToken: string,
  imageData: string,
  altText: string,
  now = new Date(),
): Promise<SignResult> {
  await ensureSchema(db);
  const nowIso = now.toISOString();

  const cardExists = await db
    .prepare('SELECT id FROM cards WHERE id = ? AND expires_at > ?')
    .bind(cardId, nowIso)
    .first<{ id: string }>();

  if (!cardExists) {
    return { ok: false, reason: 'card_not_found' };
  }

  const finalAlt = altText || `Assinatura manuscrita no espaço ${slotIndex + 1}`;

  const updateRes = await db
    .prepare(
      `UPDATE slots
       SET status = 'signed',
           image_data = ?,
           alt_text = ?,
           signed_at = ?,
           lock_token = NULL,
           lock_expires_at = NULL
       WHERE card_id = ?
         AND slot_index = ?
         AND status = 'empty'
         AND (lock_token IS NULL OR lock_token = ? OR lock_expires_at <= ?)`,
    )
    .bind(imageData, finalAlt, nowIso, cardId, slotIndex, sessionToken, nowIso)
    .run();

  const refreshed = await getCard(db, cardId, sessionToken, now);
  if (!refreshed) {
    return { ok: false, reason: 'card_not_found' };
  }

  if ((updateRes.meta?.changes ?? 0) > 0) {
    return { ok: true, card: refreshed };
  }

  const slot = refreshed.slots[slotIndex];
  if (slot?.status === 'signed') {
    return { ok: false, reason: 'already_signed', slots: refreshed.slots };
  }

  return { ok: false, reason: 'locked_by_other', slots: refreshed.slots };
}

export async function purgeExpiredCards(db: D1Database, now = new Date()): Promise<number> {
  await ensureSchema(db);
  const nowIso = now.toISOString();

  // Garante limpeza dos slots caso PRAGMA foreign_keys não esteja ativo na conexão
  await db
    .prepare('DELETE FROM slots WHERE card_id IN (SELECT id FROM cards WHERE expires_at <= ?)')
    .bind(nowIso)
    .run();

  const res = await db
    .prepare('DELETE FROM cards WHERE expires_at <= ?')
    .bind(nowIso)
    .run();

  return res.meta?.changes ?? 0;
}
