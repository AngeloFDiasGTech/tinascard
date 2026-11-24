/**
 * Logo vetorial SVG "Tinas Card" — tema infanto-juvenil/festivo neutro,
 * versátil para chá de fralda, 15 anos, casamento, aniversários e despedidas.
 */
export function renderTinasCardLogo(size: 'large' | 'compact' = 'large'): string {
  const widthClass = size === 'large' ? 'brand-logo-svg' : 'brand-logo-svg brand-logo-svg--compact';

  return `
    <svg
      class="${widthClass}"
      viewBox="0 0 420 126"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Tinas Card"
    >
      <!-- Confetes / estrelinhas neutras festivas -->
      <circle cx="38" cy="24" r="5" fill="#F59E0B" />
      <circle cx="386" cy="26" r="5.5" fill="#0D9488" />
      <circle cx="368" cy="102" r="4.5" fill="#F43F5E" />
      <path d="M56 102L59 95L62 102L69 105L62 108L59 115L56 108L49 105L56 102Z" fill="#6366F1" />
      <path d="M394 64L396.5 58L399 64L405 66.5L399 69L396.5 75L394 69L388 66.5L394 64Z" fill="#F59E0B" />

      <!-- Mini cartão com assinatura manuscrita à esquerda -->
      <g transform="translate(24, 30) rotate(-7 38 30)">
        <rect x="2" y="4" width="76" height="58" rx="13" fill="#4338CA" opacity="0.16" />
        <rect x="0" y="0" width="76" height="58" rx="13" fill="#FFFFFF" stroke="#4338CA" stroke-width="3.5" />
        <line x1="14" y1="16" x2="48" y2="16" stroke="#CBD5E1" stroke-width="3" stroke-linecap="round" />
        <path
          d="M14 40C19 26 25 27 28 38C31 46 37 29 42 36C46 41 51 37 58 34"
          stroke="#BE123C"
          stroke-width="3.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <!-- Ponta de caneta estilizada -->
        <path d="M54 14L64 4L70 10L60 20L52 22L54 14Z" fill="#F59E0B" stroke="#1E1B4B" stroke-width="2" stroke-linejoin="round" />
      </g>

      <!-- Tipografia principal "Tinas Card" -->
      <text
        x="118"
        y="74"
        font-family="'Fredoka', 'Montserrat', sans-serif"
        font-size="52"
        font-weight="700"
        letter-spacing="-0.5"
        fill="#312E81"
      >Tinas</text>
      <text
        x="266"
        y="74"
        font-family="'Fredoka', 'Montserrat', sans-serif"
        font-size="52"
        font-weight="700"
        letter-spacing="-0.5"
        fill="#BE123C"
      >Card</text>

      <!-- Sublinhado lúdico em onda suave -->
      <path
        d="M120 90C165 100 220 84 265 92C306 99 342 92 374 86"
        stroke="#0D9488"
        stroke-width="4.5"
        stroke-linecap="round"
        opacity="0.85"
      />
    </svg>
  `;
}
