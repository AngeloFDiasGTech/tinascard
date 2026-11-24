import './styles/tokens.css';
import './styles/base.css';
import './styles/card.css';
import './styles/print.css';

import { isValidCardCode, normalizeCardCode } from '../shared/validation';
import { mountCardView } from './components/cardView';
import { mountHomeView } from './components/homeView';
import { mountThanksView } from './components/thanksView';

const appRoot = document.querySelector<HTMLElement>('#app')!;
let unmountCurrentView: (() => void) | null = null;
let lastSignedCardName: string | undefined;

function navigate(path: string, replace = false): void {
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  renderRoute();
}

function renderHomeWithNotice(notice?: string): void {
  if (unmountCurrentView) {
    unmountCurrentView();
    unmountCurrentView = null;
  }

  unmountCurrentView = mountHomeView(appRoot, {
    initialTab: notice ? 'view' : 'create',
    initialNotice: notice,
    onNavigateCard: (cardId) => navigate(`/c/${cardId}`),
  });
}

function renderRoute(): void {
  if (unmountCurrentView) {
    unmountCurrentView();
    unmountCurrentView = null;
  }

  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';

  // Rota de agradecimento: /c/:id/obrigado ou /obrigado
  if (pathname === '/obrigado' || /^\/c\/[A-Za-z0-9]+\/obrigado$/i.test(pathname)) {
    unmountCurrentView = mountThanksView(appRoot, {
      cardName: lastSignedCardName,
      onGoHome: () => {
        lastSignedCardName = undefined;
        navigate('/');
      },
    });
    return;
  }

  // Rota direta do cartão: /c/:id (ou /:id se código válido de 6 chars)
  const cardMatch = pathname.match(/^\/c\/([A-Za-z0-9_-]+)$/i);
  const directCodeMatch = pathname.match(/^\/([A-Za-z0-9]{6})$/);
  const matchedCode = cardMatch?.[1] ?? directCodeMatch?.[1];

  if (matchedCode) {
    const code = normalizeCardCode(matchedCode);
    if (isValidCardCode(code)) {
      if (pathname !== `/c/${code}`) {
        window.history.replaceState({}, '', `/c/${code}`);
      }
      unmountCurrentView = mountCardView(appRoot, {
        cardId: code,
        onCardNotFound: (message) => {
          window.history.replaceState({}, '', '/');
          renderHomeWithNotice(message);
        },
        onFinishSession: (cardName, cardId) => {
          lastSignedCardName = cardName;
          navigate(`/c/${cardId}/obrigado`);
        },
      });
      return;
    }
  }

  // Rota padrão: Tela Inicial
  if (pathname !== '/') {
    window.history.replaceState({}, '', '/');
  }
  renderHomeWithNotice();
}

window.addEventListener('popstate', renderRoute);
renderRoute();
