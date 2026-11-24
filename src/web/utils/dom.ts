export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDatePtBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/**
 * Renderiza o footer obrigatório (apenas "Criado por AngeloFDiasG.Tech").
 */
export function renderFooter(): string {
  return `
    <footer class="site-footer">
      Criado por
      <a href="https://angelofdiasg.tech" target="_blank" rel="noopener noreferrer">
        AngeloFDiasG.Tech
      </a>
    </footer>
  `;
}

let toastContainer: HTMLElement | null = null;

function ensureToastContainer(): HTMLElement {
  if (toastContainer && document.body.contains(toastContainer)) {
    return toastContainer;
  }
  const el = document.createElement('div');
  el.className = 'toast-region';
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  document.body.appendChild(el);
  toastContainer = el;
  return el;
}

export function showToast(
  message: string,
  variant: 'default' | 'success' | 'error' = 'default',
  durationMs = 3600,
): void {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${variant !== 'default' ? `toast--${variant}` : ''}`;
  toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, durationMs);
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Mantém o foco do teclado preso dentro de um modal (WCAG 2.1.2 / WAI-ARIA Dialog).
 */
export function attachFocusTrap(
  container: HTMLElement,
  onEscape?: () => void,
): () => void {
  const handleKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && onEscape) {
      ev.preventDefault();
      onEscape();
      return;
    }

    if (ev.key !== 'Tab') return;

    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null,
    );

    if (focusables.length === 0) {
      ev.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (ev.shiftKey) {
      if (!active || active === first || !container.contains(active)) {
        ev.preventDefault();
        last.focus();
      }
    } else if (!active || active === last || !container.contains(active)) {
      ev.preventDefault();
      first.focus();
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}
