-- Tinas Card - Initial Schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_expires_at ON cards(expires_at);

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
);

CREATE INDEX IF NOT EXISTS idx_slots_card_status ON slots(card_id, status);
