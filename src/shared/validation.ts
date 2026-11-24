import { TOTAL_SLOTS } from './layout';

export const CARD_NAME_MAX_LENGTH = 100;
export const CARD_MESSAGE_MAX_LENGTH = 220;
export const CARD_TTL_DAYS = 45;
export const CARD_CODE_LENGTH = 6;
export const CARD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SLOT_LOCK_TTL_SECONDS = 180; // 3 minutos
export const MAX_IMAGE_DATA_LENGTH = 450_000; // ~330 KB em base64 (mais que suficiente para PNG 300 DPI)
export const MAX_ALT_TEXT_LENGTH = 300;

export function normalizeCardCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Permite colar um link completo como https://tinascard.angelofdiasg.tech/c/K7M9P2
  const urlMatch = trimmed.match(/\/c\/([A-Za-z0-9_-]+)/i);
  const candidate = urlMatch ? urlMatch[1] : trimmed;

  return candidate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function isValidCardCode(code: string): boolean {
  const normalized = normalizeCardCode(code);
  if (normalized.length < 4 || normalized.length > 16) {
    return false;
  }
  return /^[A-Z0-9]+$/.test(normalized);
}

export function validateCreateCardInput(input: { name?: unknown; message?: unknown }): {
  ok: true;
  name: string;
  message: string;
} | {
  ok: false;
  error: string;
} {
  if (typeof input.name !== 'string' || typeof input.message !== 'string') {
    return { ok: false, error: 'Nome e mensagem do cartão são obrigatórios.' };
  }

  const name = input.name.replace(/\s+/g, ' ').trim();
  const message = input.message.replace(/\r\n/g, '\n').trim();

  if (!name) {
    return { ok: false, error: 'Informe o nome do seu cartão.' };
  }
  if (name.length > CARD_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `O nome do cartão deve ter no máximo ${CARD_NAME_MAX_LENGTH} caracteres.`,
    };
  }

  if (!message) {
    return { ok: false, error: 'Informe uma mensagem curta para o topo do cartão.' };
  }
  if (message.length > CARD_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `A mensagem curta deve ter no máximo ${CARD_MESSAGE_MAX_LENGTH} caracteres.`,
    };
  }

  return { ok: true, name, message };
}

export function isValidSlotIndex(slotIndex: number): boolean {
  return Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < TOTAL_SLOTS;
}

export function validateSignSlotInput(input: { imageData?: unknown; altText?: unknown }): {
  ok: true;
  imageData: string;
  altText: string;
} | {
  ok: false;
  error: string;
} {
  if (typeof input.imageData !== 'string') {
    return { ok: false, error: 'A imagem da assinatura é obrigatória.' };
  }

  const imageData = input.imageData.trim();
  if (!imageData.startsWith('data:image/png;base64,')) {
    return { ok: false, error: 'Formato de imagem inválido. Esperado PNG.' };
  }

  if (imageData.length < 100 || imageData.length > MAX_IMAGE_DATA_LENGTH) {
    return { ok: false, error: 'Tamanho da imagem de assinatura inválido ou excede o limite.' };
  }

  const base64Body = imageData.slice('data:image/png;base64,'.length);
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64Body)) {
    return { ok: false, error: 'Dados base64 da assinatura inválidos.' };
  }

  const rawAlt = typeof input.altText === 'string' ? input.altText : '';
  const altText = rawAlt.replace(/\s+/g, ' ').trim().slice(0, MAX_ALT_TEXT_LENGTH);

  return { ok: true, imageData, altText };
}
