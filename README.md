# Tinas Card

WebApp responsivo de **Cartão de Presentes com Assinatura Virtual**, pronto para assinar no celular ou desktop e imprimir fielmente em formato **A4**.

## Principais Recursos

- **Tela Inicial clean e acessível (sem header):** logo vetorial "Tinas Card" com tema infanto-juvenil/festivo neutro (serve para chá de fralda, 15 anos, casamento, aniversários e despedidas), abas acessíveis **Criar** e **Visualizar** e footer exclusivo com crédito.
- **Armazenamento de 45 dias + Código Único:** gera automaticamente um código alfanumérico de 6 caracteres legíveis (sem ambiguidade `0/O`, `1/I`) e expurga cartões vencidos automaticamente via Cron Trigger diário na Cloudflare.
- **Link direto compartilhável:** `/c/<CODIGO>` abre o cartão diretamente sem precisar digitar na tela inicial, com botão de compartilhar/copiar link.
- **Cartão A4 WYSIWYG (2 páginas, 24 espaços orgânicos):**
  - **Página 1:** cabeçalho discreto com nome + ID, mensagem curta em fonte **Montserrat** (até 220 caracteres), *"Assinado por:"* e **10 espaços** retangulares de proporções levemente variadas.
  - **Página 2:** cabeçalho discreto e **14 espaços** adicionais. **Oculta automaticamente na impressão** enquanto não possuir assinaturas.
  - Impressão fiel em A4 (`@page { size: A4 portrait; margin: 0; }`), removendo guias, botões e barra de controles.
- **Zoom fluido:** suporte a pinça com 2 dedos no celular/tablet, `Ctrl + Scroll` no desktop e botões acessíveis (`−`, `Ajustar`, `+`).
- **Modo de assinatura focado no espaço:**
  - Controles **fora da caixa** (`Texto`, `Desenhe`, `Desfazer traço`, `Limpar desenho`, `Cancelar`, `Finalizar`).
  - Permite combinar **Texto (fonte manuscrita)** + **OK** + **Desenhe** à mão livre (mouse, dedo ou caneta com traço orgânico via `perfect-freehand`) no mesmo espaço.
  - Pop-up de confirmação antes de "queimar" definitivamente a área em PNG de alta resolução.
- **Proteção contra Concorrência (3 camadas):**
  1. **Reserva temporária (Soft Lock de 3 min)** com atualização automática a cada 5s exibindo *"Assinando agora..."* para outros convidados.
  2. **Gravação atômica no D1 (Hard Lock)** impedindo sobrescrita de assinaturas.
  3. **Resgate sem perda de trabalho:** em caso de conflito (HTTP `409`), a assinatura pronta é preservada e o usuário escolhe outro espaço livre com 1 clique.
- **Botão flutuante "Finalizar assinatura":** permite assinar um ou vários espaços (ex.: família no mesmo celular) e encerrar indo para a tela de agradecimento.
- **Acessibilidade WCAG 2.2 AA:** abas WAI-ARIA, *focus trap* em modais, contraste AA, navegação 100% por teclado, `alt` automático nas assinaturas queimadas e auditoria automatizada com `@axe-core/playwright`.

---

## Stack

- **Frontend:** HTML5, CSS3, TypeScript (Vanilla + Vite), `perfect-freehand`
- **Backend / Edge:** Cloudflare Workers + Hono + Static Assets
- **Banco de Dados:** Cloudflare D1 (SQLite serverless — 100% no plano gratuito)
- **Qualidade & Testes:** Vitest (unitário + concorrência em SQLite real) + Playwright + `@axe-core/playwright` (E2E e WCAG 2.2 AA)

---

## Desenvolvimento Local

```bash
npm install
npm run dev
```

O servidor local sobe frontend + Worker + D1 emulado em `http://localhost:5173`.

### Scripts úteis

```bash
npm run typecheck   # Checagem TypeScript estrita
npm test            # Testes unitários e de concorrência (Vitest + SQLite)
npm run test:e2e    # Testes E2E + Auditoria WCAG 2.2 AA (Playwright + Axe)
npm run build       # Build de produção (Client + Worker)
```

---

## Deploy via Integração Git na Cloudflare (`tinascard.angelofdiasg.tech`)

O banco D1 **`tinascard-db`** (`9098e050-b734-40cb-965f-240d39460556`), as tabelas iniciais (`cards` e `slots`), o domínio personalizado **`tinascard.angelofdiasg.tech`** (`custom_domain: true`) e o cron diário de 45 dias já estão configurados no [`wrangler.jsonc`](wrangler.jsonc).

Para publicar via Git:

1. Faça commit e `git push` deste repositório para o seu provedor Git (GitHub/GitLab).
2. No painel da Cloudflare, vá em **Compute (Workers) → Create → Import a repository** e selecione este repositório.
3. Configure os comandos de build:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
4. Ao concluir o primeiro deploy, a Cloudflare criará automaticamente o registro DNS, emitirá o certificado SSL e publicará o app em **`https://tinascard.angelofdiasg.tech`**.
