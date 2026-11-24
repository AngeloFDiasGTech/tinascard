import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function expectNoWcagViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe('Tinas Card — Fluxo Completo, Concorrência e WCAG 2.2 AA', () => {
  test('tela inicial sem header, abas acessíveis, footer correto e busca por código inexistente', async ({
    page,
  }) => {
    await page.goto('/');

    // Sem <header> na tela inicial
    await expect(page.locator('header')).toHaveCount(0);

    // Logo grande "Tinas Card"
    await expect(page.getByRole('img', { name: 'Tinas Card' })).toBeVisible();

    // Footer apenas com "Criado por AngeloFDiasG.Tech" linkando para angelofdiasg.tech
    const footer = page.locator('footer');
    await expect(footer).toContainText('Criado por');
    const footerLink = footer.getByRole('link', { name: /AngeloFDiasG\.Tech/i });
    await expect(footerLink).toHaveAttribute('href', 'https://angelofdiasg.tech');

    // Navegação por teclado entre abas (WAI-ARIA Tabs)
    const tabCreate = page.getByRole('tab', { name: 'Criar' });
    const tabView = page.getByRole('tab', { name: 'Visualizar' });
    await tabCreate.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabView).toHaveAttribute('aria-selected', 'true');

    // Buscar código que não existe
    await page.getByLabel(/Informe código único/i).fill('NAOEX9');
    await page.getByRole('button', { name: 'Visualizar cartão de assinaturas' }).click();
    await expect(page.getByRole('alert')).toContainText(/não existe/i);

    // Auditoria WCAG 2.2 AA na tela inicial
    await expectNoWcagViolations(page);
  });

  test('cria cartão, combina Texto + Desenho, valida concorrência entre 2 usuários, Página 2 na impressão e tela de agradecimento', async ({
    browser,
    page,
  }) => {
    await page.goto('/');

    // 1. Criar cartão
    await page.getByLabel('Digite o nome do seu cartão').fill('Chá de Fralda da Tina');
    await page
      .getByLabel('Mensagem curta')
      .fill('Seja bem-vinda, Tina! Estamos todos muito felizes com a sua chegada.');
    await page.getByRole('button', { name: 'Criar cartão de assinaturas' }).click();

    await page.waitForURL(/\/c\/[A-Z0-9]{6}$/);
    const cardUrl = page.url();

    // Verifica conteúdo do cartão A4 e 24 espaços
    await expect(page.getByText('Assinado por:')).toBeVisible();
    await expect(page.locator('[data-slot-index]')).toHaveCount(24);
    // Página 2 oculta na impressão enquanto estiver vazia
    await expect(page.locator('#sheet-wrapper-2')).toHaveClass(/sheet-wrapper--print-hidden/);

    // Auditoria WCAG 2.2 AA na tela do cartão
    await expectNoWcagViolations(page);

    // 2. Seleciona o espaço 1 (índice 0) para assinar
    await page.locator('[data-slot-index="0"]').click();
    const editorModal = page.getByTestId('slot-editor-modal');
    await expect(editorModal).toBeVisible();

    // Botão Finalizar começa desabilitado
    const finishSlotBtn = editorModal.getByRole('button', { name: 'Finalizar' });
    await expect(finishSlotBtn).toBeDisabled();

    // 3. Concorrência: segundo usuário abre o mesmo link em outro contexto e vê o espaço 1 bloqueado!
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(cardUrl);
    const lockedSlotForSecondUser = secondPage.locator('[data-slot-index="0"]');
    await expect(lockedSlotForSecondUser).toHaveAttribute('data-slot-status', 'locked');
    await expect(lockedSlotForSecondUser).toBeDisabled();
    await expect(lockedSlotForSecondUser).toContainText('Assinando agora...');

    // 4. Primeiro usuário digita texto -> OK -> depois clica em Desenhe e faz um traço
    await editorModal.getByRole('button', { name: 'Texto', exact: true }).click();
    await editorModal.getByPlaceholder(/Escreva sua mensagem/i).fill('Parabéns, Tina!\nMaria Silva');
    await editorModal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(finishSlotBtn).toBeEnabled();

    await editorModal.getByRole('button', { name: 'Desenhe', exact: true }).click();
    const canvasBox = await editorModal.locator('#editor-canvas').boundingBox();
    expect(canvasBox).not.toBeNull();
    if (canvasBox) {
      await page.mouse.move(canvasBox.x + 40, canvasBox.y + canvasBox.height * 0.72);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + 140, canvasBox.y + canvasBox.height * 0.65, { steps: 6 });
      await page.mouse.move(canvasBox.x + 220, canvasBox.y + canvasBox.height * 0.78, { steps: 6 });
      await page.mouse.up();
    }

    // 5. Clica em Finalizar -> Pop-up de confirmação -> Salvar
    await finishSlotBtn.click();
    const confirmModal = page.getByTestId('confirm-sign-modal');
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal).toContainText(/riscando/i);

    await confirmModal.getByRole('button', { name: 'Salvar' }).click();
    await expect(confirmModal).toBeHidden();
    await expect(editorModal).toBeHidden();

    // Verifica que o espaço 1 foi "queimado" com imagem
    const signedSlot = page.locator('[data-slot-index="0"]');
    await expect(signedSlot).toHaveAttribute('data-slot-status', 'signed');
    await expect(signedSlot.locator('img')).toBeVisible();

    // Segundo usuário recarrega e já vê o espaço 1 assinado (como papel de verdade)
    await secondPage.reload();
    await expect(secondPage.locator('[data-slot-index="0"]')).toHaveAttribute(
      'data-slot-status',
      'signed',
    );
    await secondContext.close();

    // 6. Assinar um espaço na Página 2 (índice 10) -> Página 2 passa a ser incluída na impressão!
    await page.locator('[data-slot-index="10"]').click();
    await page.getByTestId('slot-editor-modal').getByRole('button', { name: 'Texto', exact: true }).click();
    await page.getByTestId('slot-editor-modal').getByPlaceholder(/Escreva sua mensagem/i).fill('Felicidades! João');
    await page.getByTestId('slot-editor-modal').getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByTestId('slot-editor-modal').getByRole('button', { name: 'Finalizar', exact: true }).click();
    await page.getByTestId('confirm-sign-modal').getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.locator('#sheet-wrapper-2')).not.toHaveClass(/sheet-wrapper--print-hidden/);

    // 7. Botão flutuante "Finalizar assinatura" -> Tela de Agradecimento -> Voltar para Home
    await page.getByRole('button', { name: /Finalizar assinatura/i }).click();
    await expect(page.getByRole('heading', { name: /Obrigado por assinar/i })).toBeVisible();
    await expectNoWcagViolations(page);

    await page.getByRole('button', { name: 'Criar / Visualizar um cartão' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('tab', { name: 'Criar' })).toBeVisible();
  });
});
