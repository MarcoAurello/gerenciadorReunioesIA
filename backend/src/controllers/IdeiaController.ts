import { Request, Response } from "express";
import { Op } from "sequelize";
import { Grupo, Ideia, Interacao, Curtida, Encaminhamento, Entrega, EncaminhamentoEntrega } from "../models";
import { GRUPO_PADRAO_ID, STATUS_IDEIA } from "../lib/constantes";
import { novoId, paraApi, texto } from "../lib/util";

class IdeiaController {
  async criar(req: Request, res: Response): Promise<Response> {
    try {
      const titulo = texto(req.body.titulo, 200);
      if (!titulo) return res.status(400).json({ message: "Informe o título da pauta." });
      const idGrupo = String(req.body.idGrupo || GRUPO_PADRAO_ID);
      const grupo = await Grupo.findByPk(idGrupo);
      if (!grupo || !grupo.Ativo) return res.status(400).json({ message: "Grupo de trabalho não encontrado ou desativado." });

      const ideia = await Ideia.create({
        ID_Ideia: novoId("IDEIA"),
        ID_Grupo: idGrupo,
        Titulo: titulo,
        Descricao: texto(req.body.descricao, 5000),
        Status: "Em Debate",
        Autor: texto(req.sessao!.nome, 120)
      });
      return res.status(201).json({ message: "Pauta cadastrada!", id: ideia.ID_Ideia });
    } catch (error) {
      console.error("Erro ao criar pauta:", error);
      return res.status(500).json({ message: "Erro ao cadastrar a pauta." });
    }
  }

  async editar(req: Request, res: Response): Promise<Response> {
    try {
      const ideia = await Ideia.findByPk(String(req.params.id));
      if (!ideia) return res.status(404).json({ message: "Pauta não encontrada." });

      const campos: Record<string, unknown> = { Atualizado_Em: new Date() };
      if (req.body.titulo !== undefined) {
        campos.Titulo = texto(req.body.titulo, 200);
        if (!campos.Titulo) return res.status(400).json({ message: "O título não pode ficar vazio." });
      }
      if (req.body.descricao !== undefined) campos.Descricao = texto(req.body.descricao, 5000);
      if (req.body.status !== undefined) {
        if (!STATUS_IDEIA.includes(req.body.status)) return res.status(400).json({ message: "Status inválido." });
        campos.Status = req.body.status;
      }
      await ideia.update(campos);
      return res.status(200).json({ message: "Pauta atualizada!", id: ideia.ID_Ideia });
    } catch (error) {
      console.error("Erro ao editar pauta:", error);
      return res.status(500).json({ message: "Erro ao atualizar a pauta." });
    }
  }

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
