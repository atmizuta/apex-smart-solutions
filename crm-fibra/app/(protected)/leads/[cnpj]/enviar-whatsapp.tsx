"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chamarAcaoComSeguranca } from "@/lib/chamar-acao";
import { MODELOS_MENSAGEM, preencherModelo } from "@/lib/documentos/mensagens-whatsapp";
import { montarLinkWhatsapp } from "@/lib/whatsapp";
import { registrarMensagemAction } from "./actions";

export function EnviarWhatsapp({
  cnpjDigits,
  telefone,
  souODono,
  razaoSocial,
  consultor,
}: {
  cnpjDigits: string;
  telefone: string | null;
  souODono: boolean;
  razaoSocial: string;
  consultor: string;
}) {
  const [modeloId, setModeloId] = useState(MODELOS_MENSAGEM[0].id);
  const [texto, setTexto] = useState(() =>
    preencherModelo(MODELOS_MENSAGEM[0].texto, { cliente: razaoSocial, consultor })
  );
  const [erro, setErro] = useState<string | null>(null);
  const [registrada, setRegistrada] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Só o dono vê o telefone e registra contato (a mesma regra da aba Cliente).
  if (!souODono) {
    return (
      <p className="text-sm text-muted-foreground">
        O envio pelo WhatsApp é do dono do lead. Baixe os arquivos acima e envie por outro meio.
      </p>
    );
  }
  if (!telefone) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum telefone válido encontrado — o contato precisa ser manual.
      </p>
    );
  }

  function trocarModelo(id: string) {
    const modelo = MODELOS_MENSAGEM.find((m) => m.id === id) ?? MODELOS_MENSAGEM[0];
    setModeloId(modelo.id);
    setTexto(preencherModelo(modelo.texto, { cliente: razaoSocial, consultor }));
  }

  function enviar() {
    if (!telefone) return;
    if (!texto.trim()) {
      setErro("Escreva uma mensagem antes de enviar");
      return;
    }
    // Abre o WhatsApp de forma síncrona no clique: esperar a gravação antes faria
    // o navegador tratar como pop-up e bloquear.
    window.open(montarLinkWhatsapp(telefone, texto), "_blank");
    setErro(null);
    startTransition(async () => {
      const resultado = await chamarAcaoComSeguranca(
        () => registrarMensagemAction(cnpjDigits, texto, "whatsapp"),
        unstable_rethrow
      );
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setRegistrada(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h4 className="text-sm font-medium">Enviar pelo WhatsApp</h4>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Clique em &quot;Copiar imagem&quot; (ou baixe o PNG) acima.</li>
        <li>Clique em &quot;Enviar pelo WhatsApp&quot;: a conversa abre com a mensagem pronta.</li>
        <li>Cole a imagem na conversa (Ctrl+V) ou anexe o arquivo e envie.</li>
      </ol>
      <div className="flex items-center gap-2">
        <label htmlFor="whatsapp-modelo" className="text-xs text-muted-foreground">
          Modelo
        </label>
        <select
          id="whatsapp-modelo"
          value={modeloId}
          onChange={(e) => trocarModelo(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
        >
          {MODELOS_MENSAGEM.map((modelo) => (
            <option key={modelo.id} value={modelo.id}>
              {modelo.rotulo}
            </option>
          ))}
        </select>
      </div>
      <textarea
        aria-label="Mensagem de WhatsApp"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={5}
        className="w-full rounded-md border border-input bg-transparent p-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button type="button" onClick={enviar} disabled={pending}>
        <MessageCircle />
        Enviar pelo WhatsApp
      </Button>
      {registrada && (
        <p className="text-sm text-green-700" role="status">
          Mensagem registrada no histórico do cliente.
        </p>
      )}
      {erro && (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
