import { getStroke } from 'perfect-freehand';

export interface NormalizedPoint {
  /** Coordenada X normalizada [0..1] relativa à largura do espaço */
  x: number;
  /** Coordenada Y normalizada [0..1] relativa à altura do espaço */
  y: number;
  /** Pressão do ponteiro [0..1] */
  p: number;
}

export type Stroke = NormalizedPoint[];

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
 * e alinhado na parte superior do espaço, deixando a área inferior livre para assinatura/desenho.
 */
function drawTypedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  const paddingX = width * 0.08;
  const paddingTop = height * 0.09;
  const paddingBottom = height * 0.1;
  const maxWidth = width - paddingX * 2;
  const maxHeight = height - paddingTop - paddingBottom;

  let fontSize = Math.round(height * 0.22);
  const minFontSize = Math.max(14, Math.round(height * 0.11));
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
    if (y <= height - paddingBottom / 2) {
      ctx.fillText(line, width / 2, y);
    }
  });
  ctx.restore();
}

function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  width: number,
  height: number,
): void {
  if (!strokes.length) return;

  const baseSize = Math.max(2.6, Math.min(width, height) * 0.022);
  ctx.save();
  ctx.fillStyle = '#111111';

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;

    const scaledPoints = stroke.map((pt) => [pt.x * width, pt.y * height, pt.p]);
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
 * Renderiza texto + desenho em um canvas qualquer (preview ao vivo ou exportação 300 DPI).
 */
export function renderSignatureComposition(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  strokes: Stroke[],
): void {
  ctx.clearRect(0, 0, width, height);
  drawTypedText(ctx, text, width, height);
  drawStrokes(ctx, strokes, width, height);
}

/**
 * Gera a imagem final PNG transparente em alta resolução (300 DPI equivalente)
 * mantendo exatamente a proporção retangular do espaço escolhido.
 */
export function exportSignaturePng(
  aspectRatio: number,
  text: string,
  strokes: Stroke[],
): string {
  const exportWidth = 960;
  const exportHeight = Math.max(220, Math.round(exportWidth / aspectRatio));

  const offscreen = document.createElement('canvas');
  offscreen.width = exportWidth;
  offscreen.height = exportHeight;

  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    throw new Error('Não foi possível inicializar o contexto de desenho.');
  }

  renderSignatureComposition(ctx, exportWidth, exportHeight, text, strokes);
  return offscreen.toDataURL('image/png');
}

export class SignatureCanvasController {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private activeStroke: Stroke | null = null;
  private activePointerId: number | null = null;
  private drawingEnabled = false;
  private typedText = '';
  private onChange: () => void;
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, onChange: () => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Contexto 2D indisponível.');
    }
    this.ctx = ctx;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;
    if (width <= 0 || height <= 0) return;

    this.ctx.save();
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const allStrokes = this.activeStroke ? [...this.strokes, this.activeStroke] : this.strokes;
    renderSignatureComposition(this.ctx, width, height, this.typedText, allStrokes);
    this.ctx.restore();
  }

  public exportPng(aspectRatio: number): string {
    return exportSignaturePng(aspectRatio, this.typedText, this.strokes);
  }

  public destroy(): void {
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
