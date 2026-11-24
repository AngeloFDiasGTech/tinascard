import {
  CARD_MESSAGE_MAX_LENGTH,
  CARD_NAME_MAX_LENGTH,
  CARD_TTL_DAYS,
  normalizeCardCode,
} from '../../shared/validation';
import { ApiError, createCardApi, getCardApi } from '../api';
import { renderFooter } from '../utils/dom';
import { renderTinasCardLogo } from './logo';

export interface HomeViewOptions {
  initialTab?: 'create' | 'view';
  initialNotice?: string;
  onNavigateCard: (cardId: string) => void;
}

export function mountHomeView(root: HTMLElement, options: HomeViewOptions): () => void {
  document.title = 'Tinas Card — Cartão de Presentes com Assinatura Virtual';
  const startTab = options.initialTab ?? 'create';

  root.innerHTML = `
    <div class="home-shell">
      <main id="main-content" class="home-main" tabindex="-1">
        <div class="brand-hero">
          <h1 class="sr-only">Tinas Card</h1>
          ${renderTinasCardLogo('large')}
          <p class="brand-tagline">
            Cartão de presentes com assinatura virtual para momentos especiais
          </p>
        </div>

        <section class="tabs-card" aria-label="Criar ou visualizar cartão de assinaturas">
          <div class="tablist" role="tablist" aria-label="Opções do cartão">
            <button
              id="tab-create"
              class="tab-btn"
              type="button"
              role="tab"
              aria-selected="${startTab === 'create' ? 'true' : 'false'}"
              aria-controls="panel-create"
              tabindex="${startTab === 'create' ? '0' : '-1'}"
            >
              Criar
            </button>
            <button
              id="tab-view"
              class="tab-btn"
              type="button"
              role="tab"
              aria-selected="${startTab === 'view' ? 'true' : 'false'}"
              aria-controls="panel-view"
              tabindex="${startTab === 'view' ? '0' : '-1'}"
            >
              Visualizar
            </button>
          </div>

          <!-- Aba 1: Criar -->
          <div
            id="panel-create"
            class="tabpanel"
            role="tabpanel"
            aria-labelledby="tab-create"
            ${startTab === 'create' ? '' : 'hidden'}
          >
            <form id="create-card-form" class="form-stack" novalidate>
              <div id="create-error" class="alert alert--error" role="alert" hidden></div>

              <div class="field">
                <div class="field-header">
                  <label class="field-label" for="card-name-input">
                    Digite o nome do seu cartão
                  </label>
                  <span id="card-name-counter" class="field-counter" aria-live="polite">
                    0/${CARD_NAME_MAX_LENGTH}
                  </span>
                </div>
                <input
                  id="card-name-input"
                  name="name"
                  class="field-input"
                  type="text"
                  maxlength="${CARD_NAME_MAX_LENGTH}"
                  required
                  autocomplete="off"
                  placeholder="Ex.: Chá de Fralda da Tina, 15 Anos da Júlia..."
                  aria-describedby="card-name-hint"
                />
                <p id="card-name-hint" class="field-hint">
                  O cartão e as assinaturas ficam salvos com um código único por ${CARD_TTL_DAYS} dias.
                </p>
              </div>

              <div class="field">
                <div class="field-header">
                  <label class="field-label" for="card-message-input">
                    Mensagem curta
                  </label>
                  <span id="card-message-counter" class="field-counter" aria-live="polite">
                    0/${CARD_MESSAGE_MAX_LENGTH}
                  </span>
                </div>
                <textarea
                  id="card-message-input"
                  name="message"
                  class="field-textarea"
                  maxlength="${CARD_MESSAGE_MAX_LENGTH}"
                  rows="3"
                  required
                  placeholder="Ex.: Seja bem-vinda, Tina! Estamos todos muito felizes com a sua chegada..."
                  aria-describedby="card-message-hint"
                ></textarea>
                <p id="card-message-hint" class="field-hint">
                  Esta mensagem aparecerá em destaque no topo do cartão. Até ${CARD_MESSAGE_MAX_LENGTH} caracteres.
                </p>
              </div>

              <button id="create-submit-btn" type="submit" class="btn btn--primary btn--full">
                Criar cartão de assinaturas
              </button>
            </form>
          </div>

          <!-- Aba 2: Visualizar -->
          <div
            id="panel-view"
            class="tabpanel"
            role="tabpanel"
            aria-labelledby="tab-view"
            ${startTab === 'view' ? '' : 'hidden'}
          >
            <form id="view-card-form" class="form-stack" novalidate>
              <div id="view-error" class="alert alert--error" role="alert" ${options.initialNotice ? '' : 'hidden'}></div>

              <div class="field">
                <label class="field-label" for="card-code-input">
                  Informe código único (id) do cartão
                </label>
                <input
                  id="card-code-input"
                  name="code"
                  class="field-input field-input--code"
                  type="text"
                  maxlength="120"
                  required
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="Ex.: K7M9P2"
                  aria-describedby="card-code-hint"
                />
                <p id="card-code-hint" class="field-hint">
                  Digite o código de 6 caracteres ou cole o link completo do cartão.
                </p>
              </div>

              <button id="view-submit-btn" type="submit" class="btn btn--primary btn--full">
                Visualizar cartão de assinaturas
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
    ${renderFooter()}
  `;

  const tabCreate = root.querySelector<HTMLButtonElement>('#tab-create')!;
  const tabView = root.querySelector<HTMLButtonElement>('#tab-view')!;
  const panelCreate = root.querySelector<HTMLElement>('#panel-create')!;
  const panelView = root.querySelector<HTMLElement>('#panel-view')!;

  const createForm = root.querySelector<HTMLFormElement>('#create-card-form')!;
  const nameInput = root.querySelector<HTMLInputElement>('#card-name-input')!;
  const nameCounter = root.querySelector<HTMLElement>('#card-name-counter')!;
  const messageInput = root.querySelector<HTMLTextAreaElement>('#card-message-input')!;
  const messageCounter = root.querySelector<HTMLElement>('#card-message-counter')!;
  const createError = root.querySelector<HTMLElement>('#create-error')!;
  const createBtn = root.querySelector<HTMLButtonElement>('#create-submit-btn')!;

  const viewForm = root.querySelector<HTMLFormElement>('#view-card-form')!;
  const codeInput = root.querySelector<HTMLInputElement>('#card-code-input')!;
  const viewError = root.querySelector<HTMLElement>('#view-error')!;
  const viewBtn = root.querySelector<HTMLButtonElement>('#view-submit-btn')!;

  if (options.initialNotice) {
    viewError.textContent = options.initialNotice;
    viewError.hidden = false;
  }

  const selectTab = (tab: 'create' | 'view', moveFocus = false) => {
    const isCreate = tab === 'create';
    tabCreate.setAttribute('aria-selected', String(isCreate));
    tabCreate.tabIndex = isCreate ? 0 : -1;
    tabView.setAttribute('aria-selected', String(!isCreate));
    tabView.tabIndex = isCreate ? -1 : 0;

    panelCreate.hidden = !isCreate;
    panelView.hidden = isCreate;

    if (moveFocus) {
      (isCreate ? tabCreate : tabView).focus();
    }
  };

  tabCreate.addEventListener('click', () => selectTab('create'));
  tabView.addEventListener('click', () => selectTab('view'));

  // Navegação por teclado nas abas conforme WAI-ARIA Authoring Practices
  const handleTabKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      const currentlyCreate = tabCreate.getAttribute('aria-selected') === 'true';
      selectTab(currentlyCreate ? 'view' : 'create', true);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      selectTab('create', true);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      selectTab('view', true);
    }
  };

  tabCreate.addEventListener('keydown', handleTabKeyDown);
  tabView.addEventListener('keydown', handleTabKeyDown);

  const updateCounter = (el: HTMLInputElement | HTMLTextAreaElement, counter: HTMLElement, max: number) => {
    const len = el.value.length;
    counter.textContent = `${len}/${max}`;
    counter.classList.toggle('field-counter--warn', len >= max - 10);
  };

  nameInput.addEventListener('input', () => {
    updateCounter(nameInput, nameCounter, CARD_NAME_MAX_LENGTH);
    if (!createError.hidden) createError.hidden = true;
  });

  messageInput.addEventListener('input', () => {
    updateCounter(messageInput, messageCounter, CARD_MESSAGE_MAX_LENGTH);
    if (!createError.hidden) createError.hidden = true;
  });

  codeInput.addEventListener('input', () => {
    if (!viewError.hidden) viewError.hidden = true;
  });

  createForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    createError.hidden = true;

    const name = nameInput.value.trim();
    const message = messageInput.value.trim();

    if (!name) {
      createError.textContent = 'Por favor, digite o nome do seu cartão.';
      createError.hidden = false;
      nameInput.focus();
      return;
    }

    if (!message) {
      createError.textContent = 'Por favor, escreva uma mensagem curta para o topo do cartão.';
      createError.hidden = false;
      messageInput.focus();
      return;
    }

    createBtn.disabled = true;
    createBtn.setAttribute('aria-busy', 'true');
    createBtn.textContent = 'Criando cartão...';

    try {
      const card = await createCardApi(name, message);
      options.onNavigateCard(card.id);
    } catch (err) {
      createError.textContent =
        err instanceof Error ? err.message : 'Não foi possível criar o cartão. Tente novamente.';
      createError.hidden = false;
    } finally {
      createBtn.disabled = false;
      createBtn.removeAttribute('aria-busy');
      createBtn.textContent = 'Criar cartão de assinaturas';
    }
  });

  viewForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    viewError.hidden = true;

    const code = normalizeCardCode(codeInput.value);
    if (!code) {
      viewError.textContent = 'Informe o código único do cartão.';
      viewError.hidden = false;
      codeInput.focus();
      return;
    }

    viewBtn.disabled = true;
    viewBtn.setAttribute('aria-busy', 'true');
    viewBtn.textContent = 'Buscando cartão...';

    try {
      const card = await getCardApi(code);
      options.onNavigateCard(card.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        viewError.textContent = 'O cartão não existe. Verifique o código informado.';
      } else {
        viewError.textContent =
          err instanceof Error ? err.message : 'Não foi possível buscar o cartão. Tente novamente.';
      }
      viewError.hidden = false;
      codeInput.focus();
    } finally {
      viewBtn.disabled = false;
      viewBtn.removeAttribute('aria-busy');
      viewBtn.textContent = 'Visualizar cartão de assinaturas';
    }
  });

  return () => {
    // Listeners estão presos a nós substituídos no unmount
  };
}
