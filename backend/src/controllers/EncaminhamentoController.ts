import { Request, Response } from "express";
import { Op, Transaction } from "sequelize";
import { sequelize, Ideia, Encaminhamento, Entrega, EncaminhamentoEntrega, Citacao } from "../models";
import { STATUS_ENCAMINHAMENTO } from "../lib/constantes";
import { dataISO, novoId, texto } from "../lib/util";

/** Lista de IDs (array ou "ENT-1,ENT-2") sem repetição; null se alguma entrega não for da pauta. */
async function entregasValidas(lista: unknown, idIdeia: string): Promise<string[] | null> {
  const ids = [...new Set((Array.isArray(lista) ? lista : String(lista || "").split(","))
    .map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) return [];
  const daPauta = await Entrega.count({ where: { ID_Entrega: { [Op.in]: ids }, ID_Ideia: idIdeia } });
  return daPauta === ids.length ? ids : null;
}

/** Deixa o encaminhamento vinculado exatamente às entregas da lista. */
async function definirEntregas(idEncaminhamento: string, ids: string[], transaction: Transaction) {
  await EncaminhamentoEntrega.destroy({ where: { ID_Encaminhamento: idEncaminhamento }, transaction });
  if (ids.length) {
    await EncaminhamentoEntrega.bulkCreate(ids.map((ID_Entrega) => ({ ID_Encaminhamento: idEncaminhamento, ID_Entrega })), { transaction });
  }
}

class EncaminhamentoController {
  async criar(req: Request, res: Response): Promise<Response> {
    try {
      const idIdeia = String(req.params.id);
      if (!(await Ideia.findByPk(idIdeia))) return res.status(404).json({ message: "Pauta não encontrada." });
      const acao = texto(req.body.acaoTexto, 2000);
      const responsavel = texto(req.body.responsavel, 120);
      if (!acao || !responsavel) return res.status(400).json({ message: "Informe a ação e o responsável." });

      const idEntregas = await entregasValidas(req.body.idEntregas, idIdeia);
      if (idEntregas === null) return res.status(400).json({ message: "Entrega não encontrada nesta pauta." });

      await sequelize.transaction(async (transaction) => {
        const enc = await Encaminhamento.create({
          ID_Encaminhamento: novoId("ENC"),
          ID_Ideia: idIdeia,
          Acao: acao,
          Responsavel: responsavel,
          Prazo: dataISO(req.body.prazo),
          Status: "Pendente"
        }, { transaction });
        await definirEntregas(enc.ID_Encaminhamento, idEntregas, transaction);
        // Encaminhamento criado a partir de uma citação: a citação fica como "Encaminhada"
        if (req.body.idCitacao) {
          await Citacao.update(
            { Status: "Encaminhada", Atualizado_Em: new Date() },
            { where: { ID_Citacao: String(req.body.idCitacao) }, transaction }
          );
        }
      });
      return res.status(201).json({ message: "Encaminhamento registrado!" });
    } catch (error) {
      console.error("Erro ao criar encaminhamento:", error);
      return res.status(500).json({ message: "Erro ao registrar o encaminhamento." });
    }
  }

  /** Muda o status e/ou as entregas vinculadas (lista vazia desvincula todas). */
  async atualizar(req: Request, res: Response): Promise<Response> {
    try {
      const enc = await Encaminhamento.findByPk(String(req.params.id));
      if (!enc) return res.status(404).json({ message: "Encaminhamento não encontrado." });

      const campos: Record<string, unknown> = { Atualizado_Em: new Date() };
      if (req.body.status !== undefined) {
        if (!STATUS_ENCAMINHAMENTO.includes(req.body.status)) return res.status(400).json({ message: "Status inválido." });
        campos.Status = req.body.status;
      }
      let idEntregas: string[] | null | undefined;
      if (req.body.idEntregas !== undefined) {
        idEntregas = await entregasValidas(req.body.idEntregas, enc.ID_Ideia);
        if (idEntregas === null) return res.status(400).json({ message: "Entrega não encontrada nesta pauta." });
      }

      await sequelize.transaction(async (transaction) => {
        await enc.update(campos, { transaction });
        if (idEntregas) await definirEntregas(enc.ID_Encaminhamento, idEntregas, transaction);
      });
      return res.status(200).json({ message: "Encaminhamento atualizado!", id: enc.ID_Ideia });
    } catch (error) {
      console.error("Erro ao atualizar encaminhamento:", error);
      return res.status(500).json({ message: "Erro ao atualizar o encaminhamento." });
    }
  }
}

export default new EncaminhamentoController();
