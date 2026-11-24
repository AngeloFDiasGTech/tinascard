export interface SlotGeometry {
  slotIndex: number;
  page: 1 | 2;
  row: number;
  col: 0 | 1;
  /** Porcentagem de largura dentro da faixa (soma ~100% na faixa) */
  widthPercent: number;
  /** Peso relativo da altura da faixa */
  heightWeight: number;
  /** Proporção aproximada largura / altura na folha A4 (usada no editor/canvas) */
  aspectRatio: number;
}

export interface PageRowLayout {
  row: number;
  heightWeight: number;
  slots: [SlotGeometry, SlotGeometry];
}

export const TOTAL_SLOTS = 24;
export const PAGE_1_SLOT_COUNT = 10;
export const PAGE_2_SLOT_COUNT = 14;

// Área útil aproximada das assinaturas no A4 (em mm):
// Largura útil ~182mm (descontando gap horizontal de ~4.5mm -> 177.5mm para as duas caixas)
// Página 1: altura útil de assinaturas ~182mm em 5 faixas -> média ~34mm por faixa
// Página 2: altura útil de assinaturas ~242mm em 7 faixas -> média ~32mm por faixa
const PAGE_1_ROWS_SPEC: Array<{ weights: [number, number]; heightWeight: number }> = [
  { weights: [54, 46], heightWeight: 1.05 },
  { weights: [45, 55], heightWeight: 0.96 },
  { weights: [52, 48], heightWeight: 1.03 },
  { weights: [47, 53], heightWeight: 0.97 },
  { weights: [55, 45], heightWeight: 0.99 },
];

const PAGE_2_ROWS_SPEC: Array<{ weights: [number, number]; heightWeight: number }> = [
  { weights: [46, 54], heightWeight: 1.02 },
  { weights: [55, 45], heightWeight: 0.97 },
  { weights: [48, 52], heightWeight: 1.04 },
  { weights: [53, 47], heightWeight: 0.96 },
  { weights: [45, 55], heightWeight: 1.02 },
  { weights: [52, 48], heightWeight: 0.98 },
  { weights: [49, 51], heightWeight: 1.01 },
];

function buildPageRows(
  page: 1 | 2,
  startIndex: number,
  spec: Array<{ weights: [number, number]; heightWeight: number }>,
  usableWidthMm: number,
  usableHeightMm: number,
  rowGapMm: number,
): PageRowLayout[] {
  const totalHeightWeight = spec.reduce((acc, r) => acc + r.heightWeight, 0);
  const netHeightMm = usableHeightMm - rowGapMm * (spec.length - 1);

  let currentIndex = startIndex;
  return spec.map((rowSpec, rowIdx) => {
    const rowHeightMm = (rowSpec.heightWeight / totalHeightWeight) * netHeightMm;
    const leftWidthMm = (rowSpec.weights[0] / 100) * usableWidthMm;
    const rightWidthMm = (rowSpec.weights[1] / 100) * usableWidthMm;

    const left: SlotGeometry = {
      slotIndex: currentIndex++,
      page,
      row: rowIdx,
      col: 0,
      widthPercent: rowSpec.weights[0],
      heightWeight: rowSpec.heightWeight,
      aspectRatio: Number((leftWidthMm / rowHeightMm).toFixed(3)),
    };

    const right: SlotGeometry = {
      slotIndex: currentIndex++,
      page,
      row: rowIdx,
      col: 1,
      widthPercent: rowSpec.weights[1],
      heightWeight: rowSpec.heightWeight,
      aspectRatio: Number((rightWidthMm / rowHeightMm).toFixed(3)),
    };

    return {
      row: rowIdx,
      heightWeight: rowSpec.heightWeight,
      slots: [left, right],
    };
  });
}

export const PAGE_1_ROWS: PageRowLayout[] = buildPageRows(1, 0, PAGE_1_ROWS_SPEC, 177.5, 184, 3.8);
export const PAGE_2_ROWS: PageRowLayout[] = buildPageRows(
  2,
  PAGE_1_SLOT_COUNT,
  PAGE_2_ROWS_SPEC,
  177.5,
  244,
  3.6,
);

export const ALL_SLOT_GEOMETRIES: SlotGeometry[] = [
  ...PAGE_1_ROWS.flatMap((r) => r.slots),
  ...PAGE_2_ROWS.flatMap((r) => r.slots),
];

export function getSlotGeometry(slotIndex: number): SlotGeometry {
  const geom = ALL_SLOT_GEOMETRIES[slotIndex];
  if (!geom) {
    throw new RangeError(`Índice de espaço inválido: ${slotIndex}`);
  }
  return geom;
}
