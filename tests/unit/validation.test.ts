import { describe, expect, it } from 'vitest';
import {
  ALL_SLOT_GEOMETRIES,
  PAGE_1_ROWS,
  PAGE_1_SLOT_COUNT,
  PAGE_2_ROWS,
  PAGE_2_SLOT_COUNT,
  TOTAL_SLOTS,
} from '../../src/shared/layout';
import {
  CARD_CODE_ALPHABET,
  CARD_MESSAGE_MAX_LENGTH,
  CARD_NAME_MAX_LENGTH,
  isValidCardCode,
  normalizeCardCode,
  validateCreateCardInput,
  validateSignSlotInput,
} from '../../src/shared/validation';
import { generateCardCode } from '../../src/worker/codegen';

describe('Validações e Layout do Tinas Card', () => {
  it('define exatamente 24 espaços distribuídos em 10 na Página 1 e 14 na Página 2', () => {
    expect(TOTAL_SLOTS).toBe(24);
    expect(PAGE_1_SLOT_COUNT).toBe(10);
    expect(PAGE_2_SLOT_COUNT).toBe(14);
    expect(ALL_SLOT_GEOMETRIES).toHaveLength(24);

    for (const row of [...PAGE_1_ROWS, ...PAGE_2_ROWS]) {
      const [left, right] = row.slots;
      expect(left.widthPercent + right.widthPercent).toBe(100);
      expect(left.widthPercent).not.toBe(right.widthPercent); // formatos levemente diferentes
      expect(left.aspectRatio).toBeGreaterThan(1.5);
      expect(right.aspectRatio).toBeGreaterThan(1.5);
    }
  });

  it('gera códigos alfanuméricos sem caracteres ambíguos (0, O, 1, I)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCardCode();
      expect(code).toHaveLength(6);
      expect(isValidCardCode(code)).toBe(true);
      for (const ch of code) {
        expect(CARD_CODE_ALPHABET).toContain(ch);
      }
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it('normaliza códigos digitados e também extrai código de links completos', () => {
    expect(normalizeCardCode(' k7m9p2 ')).toBe('K7M9P2');
    expect(normalizeCardCode('https://tinascard.angelofdiasg.tech/c/ab34cd')).toBe('AB34CD');
    expect(normalizeCardCode('/c/Xy98Zt/')).toBe('XY98ZT');
  });

  it('valida limites de nome (100 chars) e mensagem curta (220 chars)', () => {
    const valid = validateCreateCardInput({
      name: '  Chá de Fralda da Tina  ',
      message: 'Seja bem-vinda Tina! Estamos todos felizes.',
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.name).toBe('Chá de Fralda da Tina');
    }

    const tooLongName = validateCreateCardInput({
      name: 'A'.repeat(CARD_NAME_MAX_LENGTH + 1),
      message: 'Mensagem válida',
    });
    expect(tooLongName.ok).toBe(false);

    const tooLongMsg = validateCreateCardInput({
      name: 'Cartão válido',
      message: 'B'.repeat(CARD_MESSAGE_MAX_LENGTH + 1),
    });
    expect(tooLongMsg.ok).toBe(false);

    const empty = validateCreateCardInput({ name: '   ', message: '' });
    expect(empty.ok).toBe(false);
  });

  it('valida payload PNG base64 de assinatura', () => {
    const fakePng = `data:image/png;base64,${'A'.repeat(200)}`;
    const valid = validateSignSlotInput({ imageData: fakePng, altText: 'Parabéns, Tina!' });
    expect(valid.ok).toBe(true);

    const wrongMime = validateSignSlotInput({ imageData: `data:image/jpeg;base64,${'A'.repeat(200)}` });
    expect(wrongMime.ok).toBe(false);

    const invalidBase64 = validateSignSlotInput({
      imageData: `data:image/png;base64,${'<script>'.repeat(30)}`,
    });
    expect(invalidBase64.ok).toBe(false);
  });
});
