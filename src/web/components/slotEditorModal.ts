import { getSlotGeometry } from '../../shared/layout';
import type { CardData, CardSlot } from '../../shared/types';
import { ApiError, lockSlotApi, signSlotApi, unlockSlotApi, unlockSlotBeacon } from '../api';
import { SignatureCanvasController } from '../canvas/signatureCanvas';
import { attachFocusTrap, escapeHtml, showToast } from '../utils/dom';

export interface SlotEditorOptions {
  cardId: string;
  slotIndex: number;
  onSaved: (updatedCard: CardData, savedSlotIndex: number) => void;
  onSlotsRefreshed: (slots: CardSlot[]) => void;
  onClose: () => void;
}

type EditorMode = 'idle' | 'text' | 'draw';

/**
 * Abre o modo focado no espaço selecionado:
 * - Mantém a reserva (Soft Lock) ativa com heartbeat a cada 60s
 * - Botões FORA da caixa: "Texto", "Desenhe", "Desfazer", "Limpar desenho", "Cancelar", "Finalizar"
 * - Permite combinar Texto (OK) + Desenhe no mesmo espaço
 * - Pop-up de confirmação antes de "queimar" definitivamente a área
 * - Resgate automático caso ocorra conflito de concorrência (409) sem perder o desenho/texto
 */
export function openSlotEditorModal(options: SlotEditorOptions): () => void {
  const { cardId } = options;
  let currentSlotIndex = options.slotIndex;
  const geom = getSlotGeometry(currentSlotIndex);
  const previousFocus = document.activeElement as HTMLElement | null;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'slot-editor-title');

  backdrop.innerHTML = `
    <div class="modal-panel" data-testid="slot-editor-modal">
      <div class="modal-header">
        <div>
          <h2 id="slot-editor-title" class="modal-title">
            Assinar espaço ${currentSlotIndex + 1} (Página ${geom.page})
          </h2>
          <p class="modal-subtitle">
            Você pode digitar um texto, desenhar à mão livre, ou combinar os dois.
          </p>
        </div>
        <button id="editor-close-x" type="button" class="btn btn--ghost" aria-label="Fechar editor e voltar ao cartão">
          ✕
        </button>
      </div>

      <!-- Controles FORA da caixa do espaço -->
      <div class="editor-tools-bar" role="toolbar" aria-label="Ferramentas de assinatura">
        <div class="editor-tools-group">
          <button id="tool-text-btn" type="button" class="btn btn--secondary" aria-pressed="false">
            <span aria-hidden="true">Aa</span> Texto
          </button>
          <button id="tool-draw-btn" type="button" class="btn btn--secondary" aria-pressed="false">
            <span aria-hidden="true">✎</span> Desenhe
          </button>
        </div>

        <div class="editor-tools-group">
          <button id="tool-undo-btn" type="button" class="btn btn--ghost" disabled>
            Desfazer traço
          </button>
          <button id="tool-clear-draw-btn" type="button" class="btn btn--ghost" disabled>
            Limpar desenho
          </button>
        </div>
      </div>

      <!-- Caixa fixa na proporção real do espaço selecionado -->
      <div class="editor-stage-wrap">
        <div
          id="editor-slot-box"
          class="editor-slot-box"
          style="aspect-ratio: ${geom.aspectRatio};"
        >
          <canvas
            id="editor-canvas"
            class="editor-canvas editor-canvas--inactive"
            aria-label="Área de assinatura e desenho"
          ></canvas>

          <div id="editor-empty-hint" class="editor-empty-hint">
            Toque em <strong>Texto</strong> para digitar ou em <strong>Desenhe</strong> para assinar com o dedo, caneta ou mouse.
          </div>

          <div id="editor-text-overlay" class="editor-text-overlay" hidden>
            <label for="editor-text-input" class="sr-only">Digite sua mensagem ou assinatura</label>
            <textarea
              id="editor-text-input"
              class="editor-text-input"
              maxlength="160"
              rows="3"
              placeholder="Escreva sua mensagem e seu nome..."
            ></textarea>
            <div class="editor-text-actions">
              <button id="text-clear-btn" type="button" class="btn btn--ghost">Limpar texto</button>
              <button id="text-ok-btn" type="button" class="btn btn--primary">OK</button>
            </div>
          </div>
        </div>
      </div>

      <div id="editor-status-msg" class="sr-only" aria-live="polite"></div>

      <div class="modal-footer">
        <button id="editor-cancel-btn" type="button" class="btn btn--secondary">
          Cancelar
        </button>
        <button id="editor-finish-btn" type="button" class="btn btn--primary" disabled>
          Finalizar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const panel = backdrop.querySelector<HTMLElement>('.modal-panel')!;
  const closeXBtn = backdrop.querySelector<HTMLButtonElement>('#editor-close-x')!;
  const toolTextBtn = backdrop.querySelector<HTMLButtonElement>('#tool-text-btn')!;
  const toolDrawBtn = backdrop.querySelector<HTMLButtonElement>('#tool-draw-btn')!;
  const toolUndoBtn = backdrop.querySelector<HTMLButtonElement>('#tool-undo-btn')!;
  const toolClearDrawBtn = backdrop.querySelector<HTMLButtonElement>('#tool-clear-draw-btn')!;
  const slotBox = backdrop.querySelector<HTMLElement>('#editor-slot-box')!;
  const canvasEl = backdrop.querySelector<HTMLCanvasElement>('#editor-canvas')!;
  const emptyHint = backdrop.querySelector<HTMLElement>('#editor-empty-hint')!;
  const textOverlay = backdrop.querySelector<HTMLElement>('#editor-text-overlay')!;
  const textInput = backdrop.querySelector<HTMLTextAreaElement>('#editor-text-input')!;
  const textOkBtn = backdrop.querySelector<HTMLButtonElement>('#text-ok-btn')!;
  const textClearBtn = backdrop.querySelector<HTMLButtonElement>('#text-clear-btn')!;
  const statusLive = backdrop.querySelector<HTMLElement>('#editor-status-msg')!;
  const cancelBtn = backdrop.querySelector<HTMLButtonElement>('#editor-cancel-btn')!;
  const finishBtn = backdrop.querySelector<HTMLButtonElement>('#editor-finish-btn')!;

  let mode: EditorMode = 'idle';
  let subModalCleanup: (() => void) | null = null;
  let closed = false;
  let saved = false;

  const updateUiState = () => {
    const hasDraftText = mode === 'text' && textInput.value.trim().length > 0;
    const hasContent = canvasCtrl.hasAnyContent() || hasDraftText;
    const hasDraw = canvasCtrl.hasDrawing();
    finishBtn.disabled = !hasContent;
    toolUndoBtn.disabled = !hasDraw;
    toolClearDrawBtn.disabled = !hasDraw;
    emptyHint.hidden = hasContent || mode !== 'idle';

    toolTextBtn.setAttribute('aria-pressed', String(mode === 'text'));
    toolTextBtn.classList.toggle('btn--active-tool', mode === 'text');
    toolDrawBtn.setAttribute('aria-pressed', String(mode === 'draw'));
    toolDrawBtn.classList.toggle('btn--active-tool', mode === 'draw');
    slotBox.classList.toggle('editor-slot-box--draw', mode === 'draw');
  };

  const canvasCtrl = new SignatureCanvasController(canvasEl, updateUiState);

  const setMode = (next: EditorMode) => {
    mode = next;
    if (next === 'text') {
      canvasCtrl.setDrawingEnabled(false);
      textInput.value = canvasCtrl.getTypedText();
      textOverlay.hidden = false;
      requestAnimationFrame(() => {
        textInput.focus();
        textInput.setSelectionRange(textInput.value.length, textInput.value.length);
      });
      statusLive.textContent = 'Modo texto ativado. Digite sua mensagem e clique em OK.';
    } else if (next === 'draw') {
      textOverlay.hidden = true;
      canvasCtrl.setDrawingEnabled(true);
      statusLive.textContent = 'Modo desenho ativado. Use o mouse, dedo ou caneta para assinar.';
    } else {
      textOverlay.hidden = true;
      canvasCtrl.setDrawingEnabled(false);
    }
    updateUiState();
  };

  // Heartbeat para renovar o soft lock enquanto o usuário estiver editando
  const heartbeatId = window.setInterval(() => {
    if (closed) return;
    lockSlotApi(cardId, currentSlotIndex).catch(() => {
      // Se perder o lock, o resgate de conflito cuidará no momento do salvamento
    });
  }, 60_000);

  const handlePageHide = () => {
    if (!closed && !saved) {
      unlockSlotBeacon(cardId, currentSlotIndex);
    }
  };
  window.addEventListener('pagehide', handlePageHide);

  const cleanup = (releaseLock: boolean) => {
    if (closed) return;
    closed = true;
    window.clearInterval(heartbeatId);
    window.removeEventListener('pagehide', handlePageHide);
    if (subModalCleanup) {
      subModalCleanup();
      subModalCleanup = null;
    }
    removeMainTrap();
    canvasCtrl.destroy();
    backdrop.remove();

    if (releaseLock) {
      void unlockSlotApi(cardId, currentSlotIndex);
    }

    if (previousFocus && document.body.contains(previousFocus)) {
      previousFocus.focus();
    }
    options.onClose();
  };

  const removeMainTrap = attachFocusTrap(panel, () => {
    // Se um sub-modal (confirmação ou conflito) estiver aberto, deixa o sub-modal lidar com Esc
    if (subModalCleanup) return;
    if (mode === 'text') {
      setMode('idle');
      toolTextBtn.focus();
      return;
    }
    cleanup(true);
  });

  toolTextBtn.addEventListener('click', () => {
    if (mode === 'text') {
      canvasCtrl.setTypedText(textInput.value);
      setMode('idle');
    } else {
      setMode('text');
    }
  });

  toolDrawBtn.addEventListener('click', () => {
    if (mode === 'text') {
      // Preserva o que a pessoa digitou caso clique direto em Desenhe
      canvasCtrl.setTypedText(textInput.value);
    }
    setMode('draw');
  });

  textInput.addEventListener('input', () => {
    updateUiState();
  });

  textOkBtn.addEventListener('click', () => {
    canvasCtrl.setTypedText(textInput.value);
    setMode('idle');
    statusLive.textContent = 'Texto aplicado ao espaço. Você também pode clicar em Desenhe ou Finalizar.';
    finishBtn.focus();
  });

  textClearBtn.addEventListener('click', () => {
    textInput.value = '';
    canvasCtrl.setTypedText('');
    textInput.focus();
  });

  toolUndoBtn.addEventListener('click', () => {
    canvasCtrl.undoStroke();
    statusLive.textContent = 'Último traço desfeito.';
  });

  toolClearDrawBtn.addEventListener('click', () => {
    canvasCtrl.clearDrawing();
    statusLive.textContent = 'Desenho limpo.';
  });

  cancelBtn.addEventListener('click', () => cleanup(true));
  closeXBtn.addEventListener('click', () => cleanup(true));

  // Sub-modal de Confirmação ("riscando o cartão")
  const openConfirmDialog = () => {
    const previewPng = canvasCtrl.exportPng(geom.aspectRatio);
    const typedText = canvasCtrl.getTypedText().trim();
    const altText = typedText
      ? canvasCtrl.hasDrawing()
        ? `${typedText} (com assinatura manuscrita)`
        : typedText
      : `Assinatura manuscrita no espaço ${currentSlotIndex + 1}`;

    const confirmBackdrop = document.createElement('div');
    confirmBackdrop.className = 'modal-backdrop';
    confirmBackdrop.setAttribute('role', 'alertdialog');
    confirmBackdrop.setAttribute('aria-modal', 'true');
    confirmBackdrop.setAttribute('aria-labelledby', 'confirm-burn-title');
    confirmBackdrop.setAttribute('aria-describedby', 'confirm-burn-desc');

    confirmBackdrop.innerHTML = `
      <div class="modal-panel modal-panel--narrow" data-testid="confirm-sign-modal">
        <h2 id="confirm-burn-title" class="modal-title">Confirmar assinatura no cartão</h2>
        <p id="confirm-burn-desc" class="modal-subtitle" style="font-size: 0.95rem; color: var(--color-text-primary); line-height: 1.5;">
          Você está "riscando" o cartão, então se sua mensagem estiver certa clique em
          <strong>"Salvar"</strong>, caso contrário volte e edite clicando em
          <strong>"Cancelar"</strong>.
        </p>

        <div class="confirm-preview-box">
          <img
            class="confirm-preview-img"
            src="${previewPng}"
            alt="Prévia da sua assinatura: ${escapeHtml(altText)}"
          />
        </div>

        <div id="confirm-error" class="alert alert--error" role="alert" hidden></div>

        <div class="modal-footer">
          <button id="confirm-cancel-btn" type="button" class="btn btn--secondary">
            Cancelar
          </button>
          <button id="confirm-save-btn" type="button" class="btn btn--success">
            Salvar
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(confirmBackdrop);
    const confirmPanel = confirmBackdrop.querySelector<HTMLElement>('.modal-panel')!;
    const confirmCancelBtn = confirmBackdrop.querySelector<HTMLButtonElement>('#confirm-cancel-btn')!;
    const confirmSaveBtn = confirmBackdrop.querySelector<HTMLButtonElement>('#confirm-save-btn')!;
    const confirmErr = confirmBackdrop.querySelector<HTMLElement>('#confirm-error')!;

    const closeConfirm = () => {
      removeConfirmTrap();
      confirmBackdrop.remove();
      subModalCleanup = null;
      finishBtn.focus();
    };

    const removeConfirmTrap = attachFocusTrap(confirmPanel, closeConfirm);
    subModalCleanup = closeConfirm;

    confirmCancelBtn.addEventListener('click', closeConfirm);

    const submitSignatureToSlot = async (targetSlotIndex: number, btn: HTMLButtonElement) => {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      const originalLabel = btn.textContent;
      btn.textContent = 'Salvando...';
      confirmErr.hidden = true;

      try {
        const targetGeom = getSlotGeometry(targetSlotIndex);
        const pngData = canvasCtrl.exportPng(targetGeom.aspectRatio);
        const updatedCard = await signSlotApi(cardId, targetSlotIndex, pngData, altText);
        saved = true;
        closeConfirm();
        cleanup(false);
        options.onSaved(updatedCard, targetSlotIndex);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.slots) {
          options.onSlotsRefreshed(err.slots);
          closeConfirm();
          openConflictRescueModal(err.message, err.slots, altText);
          return;
        }
        confirmErr.textContent =
          err instanceof Error ? err.message : 'Erro ao salvar assinatura. Tente novamente.';
        confirmErr.hidden = false;
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.textContent = originalLabel;
      }
    };

    confirmSaveBtn.addEventListener('click', () => {
      void submitSignatureToSlot(currentSlotIndex, confirmSaveBtn);
    });

    confirmSaveBtn.focus();
  };

  // Sub-modal de Resgate de Conflito (Concorrência): preserva a assinatura pronta!
  const openConflictRescueModal = (message: string, latestSlots: CardSlot[], altText: string) => {
    const freeSlots = latestSlots.filter((s) => s.status === 'empty');

    const conflictBackdrop = document.createElement('div');
    conflictBackdrop.className = 'modal-backdrop';
    conflictBackdrop.setAttribute('role', 'dialog');
    conflictBackdrop.setAttribute('aria-modal', 'true');
    conflictBackdrop.setAttribute('aria-labelledby', 'conflict-title');

    conflictBackdrop.innerHTML = `
      <div class="modal-panel modal-panel--narrow" data-testid="conflict-rescue-modal">
        <h2 id="conflict-title" class="modal-title">Espaço acabou de ser preenchido</h2>
        <div class="alert alert--warning" role="alert">${escapeHtml(message)}</div>

        ${
          freeSlots.length > 0
            ? `
          <p class="modal-subtitle">
            Sua assinatura não foi perdida! Selecione outro espaço livre para salvá-la agora:
          </p>
          <div class="conflict-slots-grid" id="conflict-slots-grid">
            ${freeSlots
              .map((s) => {
                const g = getSlotGeometry(s.slotIndex);
                return `
                  <button
                    type="button"
                    class="btn btn--secondary"
                    data-rescue-slot="${s.slotIndex}"
                  >
                    Espaço ${s.slotIndex + 1} (Pág. ${g.page})
                  </button>
                `;
              })
              .join('')}
          </div>
        `
            : `
          <p class="modal-subtitle">
            Todos os 24 espaços deste cartão já foram preenchidos ou estão sendo assinados no momento.
          </p>
        `
        }

        <div class="modal-footer">
          <button id="conflict-close-btn" type="button" class="btn btn--secondary">
            Voltar ao editor
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(conflictBackdrop);
    const conflictPanel = conflictBackdrop.querySelector<HTMLElement>('.modal-panel')!;
    const closeConflictBtn = conflictBackdrop.querySelector<HTMLButtonElement>('#conflict-close-btn')!;

    const closeConflict = () => {
      removeConflictTrap();
      conflictBackdrop.remove();
      subModalCleanup = null;
      finishBtn.focus();
    };

    const removeConflictTrap = attachFocusTrap(conflictPanel, closeConflict);
    subModalCleanup = closeConflict;
    closeConflictBtn.addEventListener('click', closeConflict);

    conflictBackdrop.querySelectorAll<HTMLButtonElement>('[data-rescue-slot]').forEach((slotBtn) => {
      slotBtn.addEventListener('click', async () => {
        const nextSlotIndex = Number(slotBtn.dataset.rescueSlot);
        slotBtn.disabled = true;
        slotBtn.textContent = 'Salvando...';
        try {
          await lockSlotApi(cardId, nextSlotIndex);
          currentSlotIndex = nextSlotIndex;
          const nextGeom = getSlotGeometry(nextSlotIndex);
          const pngData = canvasCtrl.exportPng(nextGeom.aspectRatio);
          const updatedCard = await signSlotApi(cardId, nextSlotIndex, pngData, altText);
          saved = true;
          closeConflict();
          cleanup(false);
          options.onSaved(updatedCard, nextSlotIndex);
        } catch (err) {
          showToast(
            err instanceof Error ? err.message : 'Esse espaço também foi ocupado. Tente outro.',
            'error',
          );
          slotBtn.remove();
        }
      });
    });

    closeConflictBtn.focus();
  };

  finishBtn.addEventListener('click', () => {
    if (mode === 'text') {
      canvasCtrl.setTypedText(textInput.value);
      setMode('idle');
    }
    if (!canvasCtrl.hasAnyContent()) return;
    openConfirmDialog();
  });

  // Foco inicial no botão Texto para boa acessibilidade via teclado
  toolTextBtn.focus();

  return () => cleanup(true);
}
