import { Request, Response } from "express";
import { CHAVES, gravarConfiguracao, obterConfigIA } from "../lib/configIA";
import { chamarIA } from "../lib/ia";
import { texto } from "../lib/util";

/** Só os 4 últimos caracteres: a chave nunca volta para o navegador. */
const finalDaChave = (chave: string) => (chave ? "…" + chave.slice(-4) : "");

/** Chave colada na tela: sem espaços, tamanho razoável e com um dos prefixos do provedor. */
function problemaNaChave(valor: string, prefixos: readonly string[], nome: string): string {
  if (/\s/.test(valor) || valor.length < 20 || valor.length > 200) return `A chave do ${nome} parece incompleta. Copie de novo, inteira.`;
  if (!prefixos.some((p) => valor.startsWith(p))) {
    return `A chave do ${nome} começa com ${prefixos.map((p) => `"${p}"`).join(" ou ")}. Confira se copiou a chave certa.`;
  }
  return "";
}

class ConfiguracaoController {
  async mostrarIA(_req: Request, res: Response): Promise<Response> {
    try {
      const c = await obterConfigIA();
      return res.status(200).json({
        message: "Configuração da IA.",
        gemini: { cadastrada: !!c.geminiKey, final: finalDaChave(c.geminiKey), origem: c.origem.gemini },
        groq: { cadastrada: !!c.groqKey, final: finalDaChave(c.groqKey), origem: c.origem.groq },
        principal: c.principal === "groq" ? "groq" : "gemini"
      });
    } catch (error) {
      console.error("Erro ao ler a configuração da IA:", error);
      return res.status(500).json({ message: "Erro ao ler a configuração da IA." });
    }
  }

  /**
   * Campos opcionais: geminiKey / groqKey (texto = cadastra ou troca; "" = remove a da tela,
   * voltando à do servidor, se houver) e principal ("gemini" ou "groq").
   */
  async salvarIA(req: Request, res: Response): Promise<Response> {
    try {
      const por = texto(req.sessao!.nome, 120);
      const alteracoes: [string, string | null][] = [];

      // O Google gera chaves no formato antigo ("AIza...") e no novo ("AQ....")
      for (const [campo, chave, prefixos, nome] of [
        ["geminiKey", CHAVES.geminiKey, ["AIza", "AQ."], "Gemini"],
        ["groqKey", CHAVES.groqKey, ["gsk_"], "Groq"]
      ] as const) {
        if (req.body[campo] === undefined) continue;
        const valor = String(req.body[campo] || "").trim();
        if (valor) {
          const problema = problemaNaChave(valor, prefixos, nome);
          if (problema) return res.status(400).json({ message: problema });
        }
        alteracoes.push([chave, valor || null]);
      }
      if (req.body.principal !== undefined) {
        if (!["gemini", "groq"].includes(req.body.principal)) return res.status(400).json({ message: "IA principal inválida." });
        alteracoes.push([CHAVES.principal, req.body.principal]);
      }
      if (!alteracoes.length) return res.status(400).json({ message: "Nada para salvar." });

      for (const [chave, valor] of alteracoes) await gravarConfiguracao(chave, valor, por);
      return res.status(200).json({ message: "Configuração da IA salva!" });
    } catch (error) {
      console.error("Erro ao salvar a configuração da IA:", error);
      return res.status(500).json({ message: "Erro ao salvar a configuração da IA." });
    }
  }

  /** Pergunta curta à IA para conferir se as chaves funcionam (mostra qual respondeu). */
  async testarIA(_req: Request, res: Response): Promise<Response> {
    try {
      const r = await chamarIA('Responda apenas com o JSON {"ok": true}');
      if (r.erro) return res.status(502).json({ message: r.erro });
      return res.status(200).json({
        message: `IA funcionando: respondeu o ${r.provedor}${r.modelo ? ` (${r.modelo})` : ""} em ${r.segundos} s.`,
        ia: { provedor: r.provedor, modelo: r.modelo, segundos: r.segundos }
      });
    } catch (error) {
      console.error("Erro ao testar a IA:", error);
      return res.status(500).json({ message: "Erro ao testar a IA." });
    }
  }
}

export default new ConfiguracaoController();
