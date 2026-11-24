export type SlotStatus = 'empty' | 'locked' | 'signed';

export interface CardSlot {
  slotIndex: number;
  status: SlotStatus;
  lockedByMe: boolean;
  lockExpiresAt: string | null;
  imageData: string | null;
  altText: string | null;
  signedAt: string | null;
}

export interface CardData {
  id: string;
  name: string;
  message: string;
  createdAt: string;
  expiresAt: string;
  slots: CardSlot[];
}

export interface CreateCardRequest {
  name: string;
  message: string;
}

export interface SignSlotRequest {
  imageData: string;
  altText?: string;
}

export interface LockSlotResponse {
  slotIndex: number;
  lockExpiresAt: string;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  slots?: CardSlot[];
  lockExpiresAt?: string;
}
