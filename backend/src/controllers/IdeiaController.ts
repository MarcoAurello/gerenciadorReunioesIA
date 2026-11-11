import { Request, Response } from "express";
import { Op } from "sequelize";
import { Ideia, Interacao, Curtida, Encaminhamento, Entrega, EncaminhamentoEntrega } from "../models";
import { paraApi } from "../lib/util";

class IdeiaController {
  /** Conteúdo completo de uma pauta: descrição inteira, sugestões/comentários, curtidas, encaminhamentos e entregas. */
  async montarDetalhe(idIdeia: string) {
    const ideia = await Ideia.findByPk(idIdeia, { raw: true });
    if (!ideia) return null;

    const where = { ID_Ideia: idIdeia };
    const [interacoes, curtidas, encaminhamentos, entregas] = await Promise.all([
      Interacao.findAll({ where, order: [["Data", "ASC"]], raw: true }),
      Curtida.findAll({ where, attributes: ["ID_Interacao", "Apelido", "Nome"], raw: true }),
      Encaminhamento.findAll({ where, order: [["Data_Criacao", "ASC"]], raw: true }),
      Entrega.findAll({ where, order: [["Data_Entrega", "ASC"]], raw: true })
    ]);

    // Entregas vinculadas a cada encaminhamento, no formato que o frontend já usa: "ENT-1,ENT-2"
    const vinculos = encaminhamentos.length
      ? await EncaminhamentoEntrega.findAll({
          where: { ID_Encaminhamento: { [Op.in]: encaminhamentos.map((e) => e.ID_Encaminhamento) } },
          raw: true
        })
      : [];
    const entregasDe: Record<string, string[]> = {};
    vinculos.forEach((v) => (entregasDe[v.ID_Encaminhamento] ||= []).push(v.ID_Entrega));

    return {
      idIdeia,
      ideia: paraApi(ideia),
      interacoes: interacoes.map(paraApi),
      curtidas: curtidas.map(paraApi),
      encaminhamentos: encaminhamentos.map((e) =>
        paraApi({ ...e, ID_Entregas: (entregasDe[e.ID_Encaminhamento] || []).join(",") })),
      // O caminho do arquivo não sai do servidor: o download passa pela rota do anexo
      entregas: entregas.map(({ Anexo_Arquivo, ...e }) => paraApi(e))
    };
  }

  async detalhe(req: Request, res: Response): Promise<Response> {
    try {
      const detalhe = await this.montarDetalhe(String(req.params.id));
      if (!detalhe) return res.status(404).json({ message: "Pauta não encontrada. Ela pode ter sido removida." });
      return res.status(200).json({ message: "Pauta carregada.", detalhe });
    } catch (error) {
      console.error("Erro ao abrir a pauta:", error);
      return res.status(500).json({ message: "Erro ao abrir a pauta." });
    }
  }
}

export default new IdeiaController();
