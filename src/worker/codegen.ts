import { CARD_CODE_ALPHABET, CARD_CODE_LENGTH } from '../shared/validation';

/**
 * Gera um código alfanumérico aleatório, fácil de ler e digitar
 * (sem caracteres ambíguos como 0/O, 1/I/L), usando Web Crypto API.
 */
export function generateCardCode(length = CARD_CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  const alphabetLen = CARD_CODE_ALPHABET.length;
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CARD_CODE_ALPHABET[bytes[i] % alphabetLen];
  }
  return code;
}
