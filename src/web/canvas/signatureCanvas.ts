import { getStroke } from 'perfect-freehand';
import type { SlotGeometry } from '../../shared/layout';

export interface NormalizedPoint {
  /** Coordenada X normalizada [0..1] relativa à largura do espaço */
  x: number;
  /** Coordenada Y normalizada [0..1] relativa à altura do espaço */
  y: number;
  /** Pressão do ponteiro [0..1] */
  p: number;
}

export type Stroke = NormalizedPoint[];

/**
 * Escala canônica fixa (~280 DPI em relação às dimensões físicas em mm na folha A4).
 * Tanto o preview (celular ou PC) quanto o PNG exportado usam EXATAMENTE estas
 * coordenadas virtuais, garantindo mesma quebra de linha e mesmo tamanho físico
 * em qualquer dispositivo e na impressão.
 */
const VIRTUAL_PX_PER_MM = 11;

export function getVirtualDimensions(geom: SlotGeometry): { width: number; height: number } {
  return {
    width: Math.round(geom.widthMm * VIRTUAL_PX_PER_MM),
    height: Math.round(geom.heightMm * VIRTUAL_PX_PER_MM),
  };
}

function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';

  const d: (string | number)[] = [];
  const [first, ...rest] = stroke;
  d.push('M', first[0], first[1]);

  if (rest.length === 0) {
    d.push('L', first[0] + 0.1, first[1] + 0.1, 'Z');
    return d.join(' ');
  }

  for (let i = 0; i < stroke.length; i++) {
    const [x0, y0] = stroke[i];
    const [x1, y1] = stroke[(i + 1) % stroke.length];
    d.push('Q', x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  d.push('Z');
  return d.join(' ');
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current) {
          lines.push(current);
          current = '';
        }
        // Palavra isolada mais larga que a caixa: quebra caractere a caractere
        if (ctx.measureText(word).width > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width <= maxWidth) {
              chunk += ch;
            } else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          current = chunk;
        } else {
          current = word;
        }
      }
    }
    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

/**
 * Desenha texto manuscrito (fonte Caveat, tinta preta) centralizado horizontalmente
 * e alinhado na parte superior do espaço, usando tamanho fixo em milímetros A4
 * para manter consistência entre celular, PC e todos os 24 espaços.
 */
function drawTypedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  virtualWidth: number,
  virtualHeight: number,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  const paddingX = Math.round(5.5 * VIRTUAL_PX_PER_MM);
  const paddingTop = Math.round(3.0 * VIRTUAL_PX_PER_MM);
  const paddingBottom = Math.round(3.2 * VIRTUAL_PX_PER_MM);
  const maxWidth = virtualWidth - paddingX * 2;
  const maxHeight = virtualHeight - paddingTop - paddingBottom;

  // ~6.6mm de altura na folha A4 — legível, proporcional e deixa amplo espaço inferior para assinatura
  let fontSize = Math.round(6.6 * VIRTUAL_PX_PER_MM);
  const minFontSize = Math.round(3.4 * VIRTUAL_PX_PER_MM);
  let lines: string[] = [];
  let lineHeight = fontSize * 1.14;

  while (fontSize >= minFontSize) {
    ctx.font = `600 ${fontSize}px 'Caveat', 'Segoe Script', cursive`;
    lines = wrapTextLines(ctx, trimmed, maxWidth);
    lineHeight = fontSize * 1.14;
    if (lines.length * lineHeight <= maxHeight) {
      break;
    }
    fontSize -= 2;
  }

  ctx.save();
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${fontSize}px 'Caveat', 'Segoe Script', cursive`;

  const startY = paddingTop + lineHeight / 2;

  lines.forEach((line, idx) => {
    const y = startY + idx * lineHeight;
    if (y <= virtualHeight - paddingBottom / 2) {
      ctx.fillText(line, virtualWidth / 2, y);
    }
  });
  ctx.restore();
}

function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  virtualWidth: number,
  virtualHeight: number,
): void {
  if (!strokes.length) return;

  // Espessura física consistente de ~0.82mm na folha A4
  const baseSize = Number((0.82 * VIRTUAL_PX_PER_MM).toFixed(2));
  ctx.save();
  ctx.fillStyle = '#111111';

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;

    const scaledPoints = stroke.map((pt) => [pt.x * virtualWidth, pt.y * virtualHeight, pt.p]);
    const outline = getStroke(scaledPoints, {
      size: baseSize,
      thinning: 0.55,
      smoothing: 0.55,
      streamline: 0.5,
      simulatePressure: stroke.every((pt) => pt.p === 0.5),
      last: true,
    });

    const pathStr = getSvgPathFromStroke(outline);
    if (!pathStr) continue;
    const path = new Path2D(pathStr);
    ctx.fill(path);
  }

  ctx.restore();
}

/**
 * Renderiza texto + desenho nas coordenadas virtuais canônicas do espaço.
 */
export function renderSignatureComposition(
  ctx: CanvasRenderingContext2D,
  virtualWidth: number,
  virtualHeight: number,
  text: string,
  strokes: Stroke[],
): void {
  ctx.clearRect(0, 0, virtualWidth, virtualHeight);
  drawTypedText(ctx, text, virtualWidth, virtualHeight);
  drawStrokes(ctx, strokes, virtualWidth, virtualHeight);
}

/**
 * Gera a imagem final PNG transparente em alta resolução (~280 DPI)
 * usando exatamente a mesma coordenada virtual exibida no preview.
 */
export function exportSignaturePng(
  geom: SlotGeometry,
  text: string,
  strokes: Stroke[],
): string {
  const { width, height } = getVirtualDimensions(geom);

  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;

  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    throw new Error('Não foi possível inicializar o contexto de desenho.');
  }

  renderSignatureComposition(ctx, width, height, text, strokes);
  return offscreen.toDataURL('image/png');
}

export class SignatureCanvasController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private virtualWidth: number;
  private virtualHeight: number;
  private strokes: Stroke[] = [];
  private activeStroke: Stroke | null = null;
  private activePointerId: number | null = null;
  private drawingEnabled = false;
  private typedText = '';
  private destroyed = false;
  private onChange: () => void;
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, geom: SlotGeometry, onChange: () => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Contexto 2D indisponível.');
    }
    this.ctx = ctx;
    const dims = getVirtualDimensions(geom);
    this.virtualWidth = dims.width;
    this.virtualHeight = dims.height;
    this.onChange = onChange;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => {
      this.syncCanvasResolution();
      this.redraw();
    });
    this.resizeObserver.observe(this.canvas);
    this.syncCanvasResolution();

    // Garante re-renderização com as métricas exatas da fonte Caveat após carregamento
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!this.destroyed) {
          this.redraw();
        }
      });
    }
  }

  public setDrawingEnabled(enabled: boolean): void {
    this.drawingEnabled = enabled;
    this.canvas.classList.toggle('editor-canvas--inactive', !enabled);
  }

  public setTypedText(text: string): void {
    this.typedText = text;
    this.redraw();
    this.onChange();
  }

  public getTypedText(): string {
    return this.typedText;
  }

  public getStrokes(): Stroke[] {
    return this.strokes;
  }

  public hasDrawing(): boolean {
    return this.strokes.length > 0;
  }

  public hasAnyContent(): boolean {
    return this.typedText.trim().length > 0 || this.strokes.length > 0;
  }

  public undoStroke(): void {
    if (this.strokes.length === 0) return;
    this.strokes.pop();
    this.redraw();
    this.onChange();
  }

  public clearDrawing(): void {
    if (this.strokes.length === 0) return;
    this.strokes = [];
    this.activeStroke = null;
    this.redraw();
    this.onChange();
  }

  public redraw(): void {
    if (this.canvas.width <= 0 || this.canvas.height <= 0) return;

    const scaleX = this.canvas.width / this.virtualWidth;
    const scaleY = this.canvas.height / this.virtualHeight;

    this.ctx.save();
    // Escala as coordenadas virtuais fixas para o tamanho real do canvas na tela
    // garantindo layout 100% idêntico entre celular, PC e PNG exportado
    this.ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    const allStrokes = this.activeStroke ? [...this.strokes, this.activeStroke] : this.strokes;
    renderSignatureComposition(
      this.ctx,
      this.virtualWidth,
      this.virtualHeight,
      this.typedText,
      allStrokes,
    );
    this.ctx.restore();
  }

  public exportPng(geom: SlotGeometry): string {
    return exportSignaturePng(geom, this.typedText, this.strokes);
  }

  public destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
  }

  private syncCanvasResolution(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const nextW = Math.round(rect.width * dpr);
    const nextH = Math.round(rect.height * dpr);
    if (this.canvas.width !== nextW || this.canvas.height !== nextH) {
      this.canvas.width = nextW;
      this.canvas.height = nextH;
    }
  }

  private toNormalizedPoint(ev: PointerEvent): NormalizedPoint {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
    const p = ev.pressure && ev.pressure > 0 ? ev.pressure : 0.5;
    return { x, y, p };
  }

  private handlePointerDown(ev: PointerEvent): void {
    if (!this.drawingEnabled) return;
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    if (this.activePointerId !== null) return;

    ev.preventDefault();
    this.activePointerId = ev.pointerId;
    try {
      this.canvas.setPointerCapture(ev.pointerId);
    } catch {
      // Alguns navegadores podem recusar captura sintética
    }
    this.activeStroke = [this.toNormalizedPoint(ev)];
    this.redraw();
  }

  private handlePointerMove(ev: PointerEvent): void {
    if (!this.drawingEnabled || this.activePointerId !== ev.pointerId || !this.activeStroke) return;
    ev.preventDefault();

    const coalesced = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [ev];
    for (const ptEvent of coalesced) {
      this.activeStroke.push(this.toNormalizedPoint(ptEvent));
    }
    this.redraw();
  }

  private handlePointerUp(ev: PointerEvent): void {
    if (this.activePointerId !== ev.pointerId) return;
    if (this.activeStroke && this.activeStroke.length > 0) {
      this.strokes.push(this.activeStroke);
      this.activeStroke = null;
      this.redraw();
      this.onChange();
    }
    this.activePointerId = null;
    try {
      this.canvas.releasePointerCapture(ev.pointerId);
    } catch {
      // Ignora
    }
  }
}
