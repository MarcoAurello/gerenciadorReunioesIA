import { Configuracao } from "../models";
import { cifrar, decifrar } from "./segredo";

/*
 * Chaves e preferências da IA. Valem as cadastradas pelo administrador na tela
 * (tabela configuracoes, chaves cifradas); o que não estiver cadastrado vem do .env.
 */
export type Origem = "tela" | "servidor" | null;
export interface ConfigIA {
  geminiKey: string;
  geminiModelo: string;
  groqKey: string;
  groqModelo: string;
  principal: string; // "groq" = Groq primeiro
  origem: { gemini: Origem; groq: Origem };
}

export const CHAVES = {
  geminiKey: "IA_GEMINI_API_KEY",
  groqKey: "IA_GROQ_API_KEY",
  principal: "IA_PRINCIPAL"
} as const;
const SECRETAS: string[] = [CHAVES.geminiKey, CHAVES.groqKey];

let cache: { config: ConfigIA; ate: number } | null = null;
export const limparCacheIA = () => { cache = null; };

export async function obterConfigIA(): Promise<ConfigIA> {
  if (cache && cache.ate > Date.now()) return cache.config;

  const linhas = await Configuracao.findAll({ where: { Chave: Object.values(CHAVES) }, raw: true });
  const doBanco: Record<string, string> = {};
  for (const l of linhas) {
    if (!l.Valor) continue;
    const valor = SECRETAS.includes(l.Chave) ? decifrar(l.Valor) : l.Valor;
    if (valor === null) console.error(`Configuração ${l.Chave} não pôde ser decifrada (o JWT_SECRET mudou?). Cadastre de novo.`);
    else doBanco[l.Chave] = valor;
  }

  const gemini = doBanco[CHAVES.geminiKey] || process.env.GEMINI_API_KEY || "";
  const groq = doBanco[CHAVES.groqKey] || process.env.GROQ_API_KEY || "";
  const config: ConfigIA = {
    geminiKey: gemini,
    geminiModelo: process.env.GEMINI_MODELO || "",
    groqKey: groq,
    groqModelo: process.env.GROQ_MODELO || "",
    principal: (doBanco[CHAVES.principal] ?? process.env.IA_PRINCIPAL ?? "").toLowerCase(),
    origem: {
      gemini: doBanco[CHAVES.geminiKey] ? "tela" : gemini ? "servidor" : null,
      groq: doBanco[CHAVES.groqKey] ? "tela" : groq ? "servidor" : null
    }
  };
  cache = { config, ate: Date.now() + 30000 };
  return config;
}

/** Grava (valor) ou apaga (null) uma configuração; as secretas vão cifradas. */
export async function gravarConfiguracao(chave: string, valor: string | null, por: string) {
  if (valor === null) {
    await Configuracao.destroy({ where: { Chave: chave } });
  } else {
    await Configuracao.upsert({
      Chave: chave,
      Valor: SECRETAS.includes(chave) ? cifrar(valor) : valor,
      Atualizado_Por: por,
      Atualizado_Em: new Date()
    });
  }
  limparCacheIA();
}
