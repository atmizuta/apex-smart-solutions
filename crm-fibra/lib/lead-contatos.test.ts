import { describe, it, expect } from "vitest";
import { contatosVisiveis } from "./lead-contatos";

const lead = {
  tel1: "1935737700",
  tel2: "",
  telefoneContato: "19991002213",
  email: "contato@empresa.com",
  razaoSocial: "NABAS & CAMARGO LTDA",
};

describe("contatosVisiveis", () => {
  it("o dono do lead vê os telefones e o e-mail", () => {
    expect(contatosVisiveis(lead, true)).toEqual({
      tel1: "1935737700",
      tel2: "",
      telefoneContato: "19991002213",
      email: "contato@empresa.com",
    });
  });

  it("quem não é o dono não vê nenhum contato (lead de outro consultor ou ainda sem dono)", () => {
    expect(contatosVisiveis(lead, false)).toBeNull();
  });

  it("devolve só os quatro campos de contato, nada além deles", () => {
    const visiveis = contatosVisiveis(lead, true);
    expect(Object.keys(visiveis ?? {}).sort()).toEqual(["email", "tel1", "tel2", "telefoneContato"]);
  });
});
