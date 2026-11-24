import {
  PAGE_1_ROWS,
  PAGE_1_SLOT_COUNT,
  PAGE_2_ROWS,
  TOTAL_SLOTS,
  type PageRowLayout,
} from '../../shared/layout';
import type { CardData, CardSlot } from '../../shared/types';
import { ApiError, getCardApi, lockSlotApi } from '../api';
import { escapeHtml, formatDatePtBr, showToast } from '../utils/dom';
import { openSlotEditorModal } from './slotEditorModal';
import { ViewportZoomController } from './viewportZoom';

export interface CardViewOptions {
  cardId: string;
  onCardNotFound: (message: string) => void;
  onFinishSession: (cardName: string, cardId: string) => void;
}

const POLL_INTERVAL_MS = 5000;

function renderPaperHeart(): string {
  return `
    <svg class="a4-paper-heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 21s-7-4.35-9.33-8.36C.78 9.42 2.42 5.5 6.08 5.12 8.2 4.9 10.1 6.02 12 7.9c1.9-1.88 3.8-3 5.92-2.78 3.66.38 5.3 4.3 3.41 7.52C19 16.65 12 21 12 21z" />
    </svg>
  `;
}

export function mountCardView(root: HTMLElement, options: CardViewOptions): () => void {
  let cardData: CardData | null = null;
  let signedInThisVisit = 0;
  let recentlySignedSlot: number | null = null;
  let isEditorOpen = false;
  let isLockingSlot = false;
  let destroyed = false;
  let zoomController: ViewportZoomController | null = null;
  let closeActiveEditor: (() => void) | null = null;

  root.innerHTML = `
    <div class="card-page">
      <main id="main-content" class="card-state-box" tabindex="-1">
        <p style="margin:0; font-weight:600;">Carregando cartão...</p>
      </main>
    </div>
  `;

  const renderSlotMarkup = (slot: CardSlot, widthPercent: number): string => {
    const slotNum = slot.slotIndex + 1;
    const styleAttr = `style="flex: 0 0 calc(${widthPercent}% - 8px);"`;

    if (slot.status === 'signed' && slot.imageData) {
      const justSignedClass =
        recentlySignedSlot === slot.slotIndex ? 'signature-slot--just-signed' : '';
      return `
        <div
          class="signature-slot signature-slot--signed ${justSignedClass}"
          data-slot-index="${slot.slotIndex}"
          data-slot-status="signed"
          ${styleAttr}
        >
          <img
            class="slot-signed-img"
            src="${slot.imageData}"
            alt="${escapeHtml(slot.altText || `Assinatura no espaço ${slotNum}`)}"
          />
        </div>
      `;
    }

    if (slot.status === 'locked' && !slot.lockedByMe) {
      return `
        <button
          type="button"
          class="signature-slot signature-slot--locked"
          data-slot-index="${slot.slotIndex}"
          data-slot-status="locked"
          aria-disabled="true"
          disabled
          aria-label="Assinando agora — espaço ${slotNum} de ${TOTAL_SLOTS} em uso por outra pessoa"
          ${styleAttr}
        >
          <span class="slot-lock-badge">Assinando agora...</span>
        </button>
      `;
    }

    return `
      <button
        type="button"
        class="signature-slot"
        data-slot-index="${slot.slotIndex}"
        data-slot-status="empty"
        aria-label="Assinar aqui — espaço ${slotNum} de ${TOTAL_SLOTS} livre"
        ${styleAttr}
      >
        <span class="slot-placeholder" aria-hidden="true">Assinar aqui</span>
      </button>
    `;
  };

  const renderRowsMarkup = (rows: PageRowLayout[], slots: CardSlot[]): string => {
    return rows
      .map((row) => {
        const [leftGeom, rightGeom] = row.slots;
        const leftSlot = slots[leftGeom.slotIndex];
        const rightSlot = slots[rightGeom.slotIndex];
        return `
          <div class="a4-slot-row" style="flex: ${row.heightWeight} 1 0;">
            ${renderSlotMarkup(leftSlot, leftGeom.widthPercent)}
            ${renderSlotMarkup(rightSlot, rightGeom.widthPercent)}
          </div>
        `;
      })
      .join('');
  };

  const renderCardScreen = (preserveZoom = false) => {
    if (!cardData || destroyed) return;

    const currentZoom = preserveZoom && zoomController ? zoomController.getZoom() : null;
    if (zoomController) {
      zoomController.destroy();
      zoomController = null;
    }

    document.title = `${cardData.name} (ID ${cardData.id}) — Tinas Card`;

    const signedCount = cardData.slots.filter((s) => s.status === 'signed').length;
    const page2HasSignatures = cardData.slots
      .slice(PAGE_1_SLOT_COUNT)
      .some((s) => s.status === 'signed');
    const isLongMessage = cardData.message.length > 125;
    const expiresLabel = formatDatePtBr(cardData.expiresAt);

    root.innerHTML = `
      <div class="card-page">
        <div class="card-toolbar" role="region" aria-label="Controles do cartão">
          <div class="card-toolbar-left">
            <span class="card-meta-pill card-meta-pill--code" title="Código único do cartão">
              ID ${escapeHtml(cardData.id)}
            </span>
            <span id="signed-count-pill" class="card-meta-pill" aria-live="polite">
              ${signedCount}/${TOTAL_SLOTS} assinaturas
            </span>
            <span class="card-meta-pill" title="Data limite de armazenamento de 45 dias">
              Válido até ${escapeHtml(expiresLabel)}
            </span>
          </div>

          <div class="card-toolbar-right">
            <div class="zoom-controls" role="group" aria-label="Controle de zoom">
              <button id="zoom-out-btn" type="button" class="zoom-btn" aria-label="Diminuir zoom">−</button>
              <button id="zoom-reset-btn" type="button" class="zoom-readout" aria-label="100% — ajustar cartão à tela">100%</button>
              <button id="zoom-in-btn" type="button" class="zoom-btn" aria-label="Aumentar zoom">+</button>
            </div>

            <button id="share-link-btn" type="button" class="btn btn--secondary">
              Compartilhar link
            </button>

            <button id="print-card-btn" type="button" class="btn btn--primary">
              Imprimir / Salvar PDF
            </button>
          </div>
        </div>

        <div class="card-helper-bar">
          Toque em um espaço livre para escrever ou desenhar sua assinatura. Use dois dedos (ou Ctrl + scroll) para dar zoom.
        </div>

        <main id="main-content" class="card-viewport" tabindex="-1">
          <div id="card-zoom-stage" class="card-zoom-stage">
            <!-- Página 1 A4 (10 espaços) -->
            <div class="sheet-wrapper">
              <span class="sheet-label" aria-hidden="true">Página 1 de 2 (A4)</span>
              <article class="a4-sheet" aria-label="Cartão ${escapeHtml(cardData.name)} — Página 1">
                <div class="a4-top-meta">
                  <span class="a4-top-line" aria-hidden="true"></span>
                  <div class="a4-top-title">
                    ${escapeHtml(cardData.name)} — <span class="a4-top-id">ID ${escapeHtml(cardData.id)}</span>
                  </div>
                  <span class="a4-top-line" aria-hidden="true"></span>
                </div>

                <div class="a4-message-block">
                  <h1 class="a4-message-text ${isLongMessage ? 'a4-message-text--long' : ''}">
                    ${escapeHtml(cardData.message)}
                  </h1>
                </div>

                <p class="a4-signed-by">Assinado por:</p>

                <div class="a4-slots-area" id="page-1-slots">
                  ${renderRowsMarkup(PAGE_1_ROWS, cardData.slots)}
                </div>

                <div class="a4-paper-footer" aria-hidden="true">
                  <span class="a4-top-line"></span>
                  ${renderPaperHeart()}
                  <span class="a4-top-line"></span>
                </div>
              </article>
            </div>

            <!-- Página 2 A4 (14 espaços — ocultada automaticamente na impressão se vazia) -->
            <div class="sheet-wrapper ${page2HasSignatures ? '' : 'sheet-wrapper--print-hidden'}" id="sheet-wrapper-2">
              <span class="sheet-label" aria-hidden="true">
                Página 2 de 2 (A4)${page2HasSignatures ? '' : ' — oculta na impressão enquanto estiver vazia'}
              </span>
              <article class="a4-sheet" aria-label="Cartão ${escapeHtml(cardData.name)} — Página 2">
                <div class="a4-top-meta">
                  <span class="a4-top-line" aria-hidden="true"></span>
                  <div class="a4-top-title">
                    ${escapeHtml(cardData.name)} — <span class="a4-top-id">ID ${escapeHtml(cardData.id)}</span> (Pág. 2)
                  </div>
                  <span class="a4-top-line" aria-hidden="true"></span>
                </div>

                <div class="a4-slots-area" id="page-2-slots">
                  ${renderRowsMarkup(PAGE_2_ROWS, cardData.slots)}
                </div>

                <div class="a4-paper-footer" aria-hidden="true">
                  <span class="a4-top-line"></span>
                  ${renderPaperHeart()}
                  <span class="a4-top-line"></span>
                </div>
              </article>
            </div>
          </div>
        </main>

        <button
          id="floating-finish-btn"
          type="button"
          class="floating-finish-btn ${signedInThisVisit > 0 ? 'floating-finish-btn--highlight' : ''}"
        >
          <span aria-hidden="true">✓</span>
          Finalizar assinatura
        </button>
      </div>
    `;

    const viewport = root.querySelector<HTMLElement>('#main-content')!;
    const stage = root.querySelector<HTMLElement>('#card-zoom-stage')!;
    const zoomOutBtn = root.querySelector<HTMLButtonElement>('#zoom-out-btn')!;
    const zoomInBtn = root.querySelector<HTMLButtonElement>('#zoom-in-btn')!;
    const zoomResetBtn = root.querySelector<HTMLButtonElement>('#zoom-reset-btn')!;
    const shareBtn = root.querySelector<HTMLButtonElement>('#share-link-btn')!;
    const printBtn = root.querySelector<HTMLButtonElement>('#print-card-btn')!;
    const floatingFinishBtn = root.querySelector<HTMLButtonElement>('#floating-finish-btn')!;

    zoomController = new ViewportZoomController(viewport, stage, (scale) => {
      const pct = `${Math.round(scale * 100)}%`;
      zoomResetBtn.textContent = pct;
      zoomResetBtn.setAttribute('aria-label', `${pct} — ajustar cartão à tela`);
    });

    if (currentZoom !== null) {
      zoomController.setZoom(currentZoom);
    }

    zoomOutBtn.addEventListener('click', () => zoomController?.zoomOut());
    zoomInBtn.addEventListener('click', () => zoomController?.zoomIn());
    zoomResetBtn.addEventListener('click', () => zoomController?.fitToWidth());

    shareBtn.addEventListener('click', async () => {
      const shareUrl = `${window.location.origin}/c/${cardData!.id}`;
      try {
        if (navigator.share) {
          await navigator.share({
            title: `Assine o cartão: ${cardData!.name}`,
            text: `Deixe sua assinatura no cartão "${cardData!.name}" (Código: ${cardData!.id})`,
            url: shareUrl,
          });
          return;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }

      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast(`Link copiado! Código do cartão: ${cardData!.id}`, 'success');
      } catch {
        window.prompt('Copie o link do cartão:', shareUrl);
      }
    });

    printBtn.addEventListener('click', () => {
      window.print();
    });

    floatingFinishBtn.addEventListener('click', () => {
      options.onFinishSession(cardData!.name, cardData!.id);
    });

    bindSlotClickHandlers();
  };

  // Atualiza somente os slots e contadores (sem resetar scroll/zoom durante polling)
  const updateSlotsInPlace = (slots: CardSlot[]) => {
    if (!cardData || destroyed) return;
    cardData = { ...cardData, slots };

    const p1Container = root.querySelector<HTMLElement>('#page-1-slots');
    const p2Container = root.querySelector<HTMLElement>('#page-2-slots');
    const countPill = root.querySelector<HTMLElement>('#signed-count-pill');
    const sheet2Wrap = root.querySelector<HTMLElement>('#sheet-wrapper-2');
    const floatingBtn = root.querySelector<HTMLButtonElement>('#floating-finish-btn');

    if (!p1Container || !p2Container) {
      renderCardScreen(true);
      return;
    }

    p1Container.innerHTML = renderRowsMarkup(PAGE_1_ROWS, slots);
    p2Container.innerHTML = renderRowsMarkup(PAGE_2_ROWS, slots);

    const signedCount = slots.filter((s) => s.status === 'signed').length;
    if (countPill) {
      countPill.textContent = `${signedCount}/${TOTAL_SLOTS} assinaturas`;
    }

    const page2HasSignatures = slots.slice(PAGE_1_SLOT_COUNT).some((s) => s.status === 'signed');
    if (sheet2Wrap) {
      sheet2Wrap.classList.toggle('sheet-wrapper--print-hidden', !page2HasSignatures);
      const label = sheet2Wrap.querySelector<HTMLElement>('.sheet-label');
      if (label) {
        label.textContent = `Página 2 de 2 (A4)${page2HasSignatures ? '' : ' — oculta na impressão enquanto estiver vazia'}`;
      }
    }

    if (floatingBtn) {
      floatingBtn.classList.toggle('floating-finish-btn--highlight', signedInThisVisit > 0);
    }

    bindSlotClickHandlers();
  };

  const handleSlotSelect = async (slotIndex: number) => {
    if (!cardData || isEditorOpen || isLockingSlot) return;

    isLockingSlot = true;
    try {
      await lockSlotApi(cardData.id, slotIndex);
      isEditorOpen = true;
      closeActiveEditor = openSlotEditorModal({
        cardId: cardData.id,
        slotIndex,
        onSaved: (updatedCard, savedIdx) => {
          signedInThisVisit += 1;
          recentlySignedSlot = savedIdx;
          cardData = updatedCard;
          updateSlotsInPlace(updatedCard.slots);
          showToast('Assinatura salva no cartão com sucesso!', 'success');

          window.setTimeout(() => {
            if (recentlySignedSlot === savedIdx) {
              recentlySignedSlot = null;
              if (cardData) updateSlotsInPlace(cardData.slots);
            }
          }, 4000);
        },
        onSlotsRefreshed: (freshSlots) => {
          updateSlotsInPlace(freshSlots);
        },
        onClose: () => {
          isEditorOpen = false;
          closeActiveEditor = null;
          // Atualiza slots após sair para refletir liberação e alterações de outros usuários
          void refreshFromServer();
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (err.slots) {
          updateSlotsInPlace(err.slots);
        }
        showToast(err.message, 'error', 4200);
      } else {
        showToast(
          err instanceof Error ? err.message : 'Não foi possível selecionar este espaço.',
          'error',
        );
      }
    } finally {
      isLockingSlot = false;
    }
  };

  const bindSlotClickHandlers = () => {
    root.querySelectorAll<HTMLButtonElement>('button.signature-slot[data-slot-status="empty"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.slotIndex);
        if (Number.isInteger(idx)) {
          void handleSlotSelect(idx);
        }
      });
    });
  };

  const refreshFromServer = async () => {
    if (destroyed || document.hidden || isEditorOpen || !cardData) return;
    try {
      const fresh = await getCardApi(cardData.id);
      if (!destroyed && !isEditorOpen) {
        updateSlotsInPlace(fresh.slots);
      }
    } catch {
      // Silencioso no polling em segundo plano
    }
  };

  // Carregamento inicial
  void (async () => {
    try {
      const loaded = await getCardApi(options.cardId);
      if (destroyed) return;
      cardData = loaded;
      renderCardScreen(false);
    } catch (err) {
      if (destroyed) return;
      if (err instanceof ApiError && err.status === 404) {
        options.onCardNotFound('O cartão não existe ou já expirou. Verifique o código informado.');
        return;
      }
      root.innerHTML = `
        <div class="card-page">
          <main id="main-content" class="card-state-box" tabindex="-1">
            <h1 style="margin:0; font-size:1.25rem;">Não foi possível carregar o cartão</h1>
            <p style="margin:0; color:var(--color-text-secondary);">
              Verifique sua conexão e tente novamente.
            </p>
            <button id="retry-load-btn" type="button" class="btn btn--primary">Tentar novamente</button>
          </main>
        </div>
      `;
      root.querySelector<HTMLButtonElement>('#retry-load-btn')?.addEventListener('click', () => {
        window.location.reload();
      });
    }
  })();

  const pollTimer = window.setInterval(() => {
    void refreshFromServer();
  }, POLL_INTERVAL_MS);

  const handleVisibilityChange = () => {
    if (!document.hidden) {
      void refreshFromServer();
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    destroyed = true;
    window.clearInterval(pollTimer);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (closeActiveEditor) {
      closeActiveEditor();
      closeActiveEditor = null;
    }
    if (zoomController) {
      zoomController.destroy();
      zoomController = null;
    }
  };
}
