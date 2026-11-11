import { Request, Response } from "express";
import { Op } from "sequelize";
import { Grupo, Ideia, Interacao, Encaminhamento, Recomendacao } from "../models";
import { GRUPO_PADRAO_ID } from "../lib/constantes";
import { chamarIA, RespostaIA } from "../lib/ia";
import { texto } from "../lib/util";

/** Recomendações ativas que valem para o GT (as gerais e as do próprio GT). */
async function recomendacoesDoGrupo(idGrupo: string) {
  const regras = await Recomendacao.findAll({
    where: { Ativo: true, [Op.or]: [{ ID_Grupo: null }, { ID_Grupo: idGrupo }] },
    order: [["Data_Criacao", "ASC"]], raw: true
  });
  return regras.filter((r) => String(r.Texto || "").trim());
}

const listaDeRecomendacoes = (regras: { Titulo: string; Texto: string }[]) =>
  regras.map((r) => `- ${r.Titulo}: ${r.Texto}`).join("\n");

/** Qual IA respondeu e em quanto tempo (mostrado discretamente na tela). */
const infoIA = (r: RespostaIA) => ({ provedor: r.provedor, modelo: r.modelo, segundos: r.segundos });

// A IA apenas sugere: nada é gravado aqui
class IAController {
  async sugerirPautas(req: Request, res: Response): Promise<Response> {
    try {
      // Só o contexto do GT aberto: cada grupo tem as suas pautas
      const idGrupo = String(req.body.idGrupo || GRUPO_PADRAO_ID);
      const grupo = (await Grupo.findByPk(idGrupo, { raw: true })) || { Nome: "GT-Sistemas", Descricao: "" };
      const ideias = await Ideia.findAll({ where: { ID_Grupo: idGrupo }, order: [["Data_Criacao", "ASC"]], raw: true });
      const encs = ideias.length
        ? await Encaminhamento.findAll({
            where: { ID_Ideia: { [Op.in]: ideias.map((i) => i.ID_Ideia) }, Status: { [Op.in]: ["Pendente", "Em Andamento"] } },
            raw: true
          })
        : [];

      const existentes = ideias
        .map((i) => `- [${i.Status}] ${i.Titulo}${i.Descricao ? ": " + String(i.Descricao).slice(0, 300) : ""}`)
        .join("\n") || "(nenhuma pauta cadastrada)";
      const pendentes = encs.map((e) => `- ${e.Acao} (resp.: ${e.Responsavel})`).join("\n") || "(nenhum)";
      const regras = await recomendacoesDoGrupo(idGrupo);
      const recomendacoes = listaDeRecomendacoes(regras);
      const tema = texto(req.body.tema, 500);

      const prompt =
        `Você assessora o grupo de trabalho "${grupo.Nome}"${grupo.Descricao ? ` (${grupo.Descricao})` : ""}` +
        ", que organiza reuniões, pautas e encaminhamentos.\n" +
        "Sugira de 3 a 5 NOVAS pautas para as próximas reuniões, sem repetir as existentes.\n" +
        (tema ? `Foco solicitado pelo grupo: ${tema}\n` : "") +
        (recomendacoes ? `\nSiga também estas recomendações definidas pela coordenação ao sugerir as pautas:\n${recomendacoes}\n` : "") +
        `\nPautas já cadastradas:\n${existentes}` +
        `\n\nEncaminhamentos em aberto:\n${pendentes}` +
        "\n\nResponda em português do Brasil, em JSON no formato " +
        '{"sugestoes":[{"titulo":"até 100 caracteres","descricao":"2 a 4 frases com contexto e objetivo","justificativa":"1 frase"}]}';

      const r = await chamarIA(prompt);
      if (r.erro) return res.status(502).json({ message: r.erro });
      return res.status(200).json({
        message: "Sugestões geradas.",
        sugestoes: (r.json.sugestoes || []).slice(0, 5),
        recomendacoesAplicadas: regras.length,
        ia: infoIA(r)
      });
    } catch (error) {
      console.error("Erro ao sugerir pautas:", error);
      return res.status(500).json({ message: "Erro ao consultar a IA." });
    }
  }

  async sugerirEncaminhamentos(req: Request, res: Response): Promise<Response> {
    try {
      const ideia = await Ideia.findByPk(String(req.params.id), { raw: true });
      if (!ideia) return res.status(404).json({ message: "Pauta não encontrada." });

      // Discussão em fio: cada sugestão seguida dos seus comentários
      const daPauta = await Interacao.findAll({ where: { ID_Ideia: ideia.ID_Ideia }, order: [["Data", "ASC"]], raw: true });
      const filhos = (id: string) => daPauta.filter((i) => i.ID_Pai === id);
      const discussao = daPauta
        .filter((i) => !i.ID_Pai)
        .map((i) => `- (${i.Tipo}) ${i.Autor}: ${i.Texto}` +
          filhos(i.ID_Interacao).map((c) => `\n    • comentário de ${c.Autor}: ${c.Texto}`).join(""))
        .join("\n") || "(sem sugestões ainda)";
      const jaEncaminhado = (await Encaminhamento.findAll({ where: { ID_Ideia: ideia.ID_Ideia }, raw: true }))
        .map((e) => `- [${e.Status}] ${e.Acao} (resp.: ${e.Responsavel})`)
        .join("\n") || "(nenhum)";
      const regras = await recomendacoesDoGrupo(ideia.ID_Grupo);
      const recomendacoes = listaDeRecomendacoes(regras);

      const prompt =
        "Você assessora um grupo de trabalho. Analise a pauta e a discussão abaixo.\n" +
        "1) Escreva uma síntese objetiva do que foi debatido (pontos de consenso e divergências).\n" +
        "2) Sugira de 2 a 5 encaminhamentos concretos e verificáveis, sem repetir os já registrados.\n" +
        "Só indique um responsável se a discussão apontar alguém; caso contrário deixe vazio.\n" +
        (recomendacoes ? `\nSiga também estas recomendações definidas pela coordenação ao fazer a síntese e os encaminhamentos:\n${recomendacoes}\n` : "") +
        `\nPauta: ${ideia.Titulo}` +
        `\nContexto: ${ideia.Descricao || "(sem descrição)"}` +
        `\n\nDiscussão:\n${discussao}` +
        `\n\nEncaminhamentos já registrados:\n${jaEncaminhado}` +
        "\n\nResponda em português do Brasil, em JSON no formato " +
        '{"sintese":"texto","encaminhamentos":[{"acao":"verbo no infinitivo + entrega","responsavel":"nome ou vazio","prazoDias":número de dias sugerido}]}';

      const r = await chamarIA(prompt);
      if (r.erro) return res.status(502).json({ message: r.erro });
      return res.status(200).json({
        message: "Sugestões geradas.",
        sintese: r.json.sintese || "",
        encaminhamentos: (r.json.encaminhamentos || []).slice(0, 5),
        recomendacoesAplicadas: regras.length,
        ia: infoIA(r)
      });
    } catch (error) {
      console.error("Erro ao sugerir encaminhamentos:", error);
      return res.status(500).json({ message: "Erro ao consultar a IA." });
    }
  }
}

export default new IAController();
