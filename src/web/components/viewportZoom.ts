const A4_WIDTH_PX = 794;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.4;

/**
 * Controla o zoom da visualização do cartão A4:
 * - Ajuste automático inicial à largura da tela (especialmente celular)
 * - Zoom por roda do mouse (Ctrl + Scroll / trackpad pinch)
 * - Pinch-to-zoom com dois dedos no celular/tablet
 * - Botões +, - e Ajustar acessíveis por teclado
 */
export class ViewportZoomController {
  private viewport: HTMLElement;
  private stage: HTMLElement;
  private onZoomChange: (scale: number) => void;
  private scale = 1;
  private activePointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private pinchStartScale = 1;
  private resizeObserver: ResizeObserver;

  constructor(
    viewport: HTMLElement,
    stage: HTMLElement,
    onZoomChange: (scale: number) => void,
  ) {
    this.viewport = viewport;
    this.stage = stage;
    this.onZoomChange = onZoomChange;

    this.handleWheel = this.handleWheel.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);

    this.viewport.addEventListener('wheel', this.handleWheel, { passive: false });
    this.viewport.addEventListener('pointerdown', this.handlePointerDown);
    this.viewport.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    this.viewport.addEventListener('pointerup', this.handlePointerUp);
    this.viewport.addEventListener('pointercancel', this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => {
      // Apenas recalcula se estiver muito grande para a nova largura sem o usuário ter dado zoom manual
      if (this.scale > 1) return;
      const fit = this.computeFitScale();
      if (Math.abs(fit - this.scale) > 0.08 && this.viewport.clientWidth < A4_WIDTH_PX + 32) {
        this.setZoom(fit);
      }
    });
    this.resizeObserver.observe(this.viewport);

    this.fitToWidth();
  }

  public getZoom(): number {
    return this.scale;
  }

  public computeFitScale(): number {
    const available = Math.max(280, this.viewport.clientWidth - 28);
    const fit = Math.min(1, available / A4_WIDTH_PX);
    return Math.max(MIN_ZOOM, Number(fit.toFixed(2)));
  }

  public fitToWidth(): void {
    this.setZoom(this.computeFitScale());
  }

  public zoomIn(): void {
    this.setZoom(this.scale + 0.15);
  }

  public zoomOut(): void {
    this.setZoom(this.scale - 0.15);
  }

  public setZoom(next: number): void {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(next.toFixed(2))));
    this.scale = clamped;
    this.stage.style.transform = `scale(${clamped})`;

    // Ajusta margem inferior compensando o scale (transform não altera altura de layout)
    requestAnimationFrame(() => {
      const naturalHeight = this.stage.scrollHeight;
      const scaledHeight = naturalHeight * clamped;
      const delta = scaledHeight - naturalHeight;
      this.stage.style.marginBottom = `${Math.round(delta)}px`;
    });

    this.onZoomChange(clamped);
  }

  public destroy(): void {
    this.resizeObserver.disconnect();
    this.viewport.removeEventListener('wheel', this.handleWheel);
    this.viewport.removeEventListener('pointerdown', this.handlePointerDown);
    this.viewport.removeEventListener('pointermove', this.handlePointerMove);
    this.viewport.removeEventListener('pointerup', this.handlePointerUp);
    this.viewport.removeEventListener('pointercancel', this.handlePointerUp);
  }

  private handleWheel(ev: WheelEvent): void {
    // Ctrl + Scroll (ou gesto de pinça no trackpad) controla o zoom do cartão
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 0.1 : -0.1;
    this.setZoom(this.scale + factor);
  }

  private handlePointerDown(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch') return;
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchStartScale = this.scale;
    }
  }

  private handlePointerMove(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch' || !this.activePointers.has(ev.pointerId)) return;
    this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (this.activePointers.size === 2 && this.pinchStartDist > 10) {
      ev.preventDefault();
      const pts = Array.from(this.activePointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / this.pinchStartDist;
      this.setZoom(this.pinchStartScale * ratio);
    }
  }

  private handlePointerUp(ev: PointerEvent): void {
    this.activePointers.delete(ev.pointerId);
    if (this.activePointers.size < 2) {
      this.pinchStartDist = 0;
    }
  }
}
