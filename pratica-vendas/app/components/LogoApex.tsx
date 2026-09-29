// Recriado em SVG a partir do "selo compacto" do Manual de Identidade
// (Identidade Visual Apex Claro/arquivos/10-selo-compacto.png) — o triângulo
// com o facete menor central é a assinatura visual da marca.
export function LogoApex({ tamanho = 28 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho * 0.86} viewBox="0 0 100 86" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="apex-esquerda" x1="0" y1="0" x2="60" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ef1c2e" />
          <stop offset="1" stopColor="#8c0000" />
        </linearGradient>
        <linearGradient id="apex-direita" x1="100" y1="0" x2="40" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c30012" />
          <stop offset="1" stopColor="#6e0000" />
        </linearGradient>
        <linearGradient id="apex-centro" x1="50" y1="40" x2="50" y2="86" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a10010" />
          <stop offset="1" stopColor="#5c0000" />
        </linearGradient>
      </defs>
      <path d="M50 3 L4 82 H50 Z" fill="url(#apex-esquerda)" />
      <path d="M50 3 L96 82 H50 Z" fill="url(#apex-direita)" />
      <path d="M50 40 L28 82 H72 Z" fill="url(#apex-centro)" />
    </svg>
  );
}
