import { escapeHtml, renderFooter } from '../utils/dom';
import { renderTinasCardLogo } from './logo';

export interface ThanksViewOptions {
  cardName?: string;
  onGoHome: () => void;
}

export function mountThanksView(root: HTMLElement, options: ThanksViewOptions): () => void {
  document.title = 'Obrigado pela sua assinatura — Tinas Card';

  const cardText = options.cardName
    ? `Sua assinatura foi registrada no cartão <strong>${escapeHtml(options.cardName)}</strong>.`
    : 'Sua assinatura foi registrada com carinho no cartão.';

  root.innerHTML = `
    <div class="home-shell">
      <main id="main-content" class="home-main" tabindex="-1">
        <div class="brand-hero">
          ${renderTinasCardLogo('large')}
        </div>

        <section class="thanks-card" aria-labelledby="thanks-heading">
          <div class="thanks-badge" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h1 id="thanks-heading" class="thanks-title">Obrigado por assinar!</h1>
          <p class="thanks-desc">
            ${cardText} Ele ficará guardado como uma lembrança especial pronta para impressão.
          </p>
          <button id="thanks-home-btn" type="button" class="btn btn--primary btn--full">
            Criar / Visualizar um cartão
          </button>
        </section>
      </main>
    </div>
    ${renderFooter()}
  `;

  const btn = root.querySelector<HTMLButtonElement>('#thanks-home-btn')!;
  btn.addEventListener('click', () => options.onGoHome());
  btn.focus();

  return () => {};
}
