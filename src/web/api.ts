import type { ApiErrorResponse, CardData, CardSlot, LockSlotResponse } from '../shared/types';

const SESSION_KEY = 'tinascard_session_token';

function generateSessionToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getOrCreateSessionToken(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,128}$/.test(existing)) {
      return existing;
    }
    const created = generateSessionToken();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return generateSessionToken();
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  slots?: CardSlot[];
  lockExpiresAt?: string;

  constructor(status: number, payload: ApiErrorResponse) {
    super(payload.message || 'Ocorreu um erro inesperado.');
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.error || 'UNKNOWN_ERROR';
    this.slots = payload.slots;
    this.lockExpiresAt = payload.lockExpiresAt;
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Token', getOrCreateSessionToken());
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const errPayload: ApiErrorResponse =
      data && typeof data === 'object' && 'message' in data
        ? (data as ApiErrorResponse)
        : {
            error: 'HTTP_ERROR',
            message: 'Não foi possível completar a operação. Tente novamente.',
          };
    throw new ApiError(response.status, errPayload);
  }

  return data as T;
}

export async function createCardApi(name: string, message: string): Promise<CardData> {
  return requestJson<CardData>('/api/cards', {
    method: 'POST',
    body: JSON.stringify({ name, message }),
  });
}

export async function getCardApi(code: string): Promise<CardData> {
  return requestJson<CardData>(`/api/cards/${encodeURIComponent(code)}`, {
    method: 'GET',
  });
}

export async function lockSlotApi(cardId: string, slotIndex: number): Promise<LockSlotResponse> {
  return requestJson<LockSlotResponse>(
    `/api/cards/${encodeURIComponent(cardId)}/slots/${slotIndex}/lock`,
    { method: 'POST' },
  );
}

export async function unlockSlotApi(cardId: string, slotIndex: number): Promise<void> {
  try {
    await requestJson<{ ok: boolean }>(
      `/api/cards/${encodeURIComponent(cardId)}/slots/${slotIndex}/lock`,
      { method: 'DELETE' },
    );
  } catch {
    // Liberação best-effort
  }
}

export function unlockSlotBeacon(cardId: string, slotIndex: number): void {
  const url = `/api/cards/${encodeURIComponent(cardId)}/slots/${slotIndex}/unlock`;
  const payload = JSON.stringify({ sessionToken: getOrCreateSessionToken() });
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
    navigator.sendBeacon(url, blob);
  }
}

export async function signSlotApi(
  cardId: string,
  slotIndex: number,
  imageData: string,
  altText: string,
): Promise<CardData> {
  return requestJson<CardData>(
    `/api/cards/${encodeURIComponent(cardId)}/slots/${slotIndex}/sign`,
    {
      method: 'POST',
      body: JSON.stringify({ imageData, altText }),
    },
  );
}
