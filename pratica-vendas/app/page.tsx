import { redirect } from 'next/navigation';

// A raiz nunca teve página própria — abrir localhost:3000 direto sempre deu
// 404 puro do Next, sem nenhuma pista de onde ir. O middleware já cuida de
// mandar pra /login quando não há sessão válida.
export default function RaizPagina() {
  redirect('/cenarios');
}
