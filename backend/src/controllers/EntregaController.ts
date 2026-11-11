import { Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import { Op, Transaction } from "sequelize";
import { sequelize, Ideia, Entrega, Encaminhamento, EncaminhamentoEntrega } from "../models";
import { STATUS_ENTREGA } from "../lib/constantes";
import { dataISO, novoId, texto } from "../lib/util";
import { PASTA_UPLOADS, nomeOriginal } from "../config/upload";

/** Deixa a entrega vinculada exatamente aos encaminhamentos da lista (só os da mesma pauta). */
async function vincularEntrega(idEntrega: string, idIdeia: string, ids: unknown, transaction: Transaction) {
  const alvo = (Array.isArray(ids) ? ids : []).map(String);
  const daPauta = await Encaminhamento.findAll({
    where: { ID_Ideia: idIdeia, ID_Encaminhamento: { [Op.in]: alvo } }, attributes: ["ID_Encaminhamento"], raw: true, transaction
  });
  await EncaminhamentoEntrega.destroy({ where: { ID_Entrega: idEntrega }, transaction });
  if (daPauta.length) {
    await EncaminhamentoEntrega.bulkCreate(
      daPauta.map((e) => ({ ID_Encaminhamento: e.ID_Encaminhamento, ID_Entrega: idEntrega })), { transaction }
    );
  }
}

const caminhoDoAnexo = (arquivo: string) => path.join(PASTA_UPLOADS, path.basename(arquivo));

class EntregaController {
  async criar(req: Request, res: Response): Promise<Response> {
    try {
      const idIdeia = String(req.params.id);
      if (!(await Ideia.findByPk(idIdeia))) return res.status(404).json({ message: "Pauta não encontrada." });
      const data = dataISO(req.body.dataEntrega);
      if (!data) return res.status(400).json({ message: "Informe a data da entrega." });

      const idEntrega = await sequelize.transaction(async (transaction) => {
        const entrega = await Entrega.create({
          ID_Entrega: novoId("ENT"),
          ID_Ideia: idIdeia,
          Data_Entrega: data,
          Responsavel: texto(req.body.responsavel, 120),
          Comentarios: texto(req.body.comentarios, 2000),
          Status: STATUS_ENTREGA[0],
          Autor: texto(req.sessao!.nome, 120)
        }, { transaction });
        if (req.body.idEncaminhamentos !== undefined) {
          await vincularEntrega(entrega.ID_Entrega, idIdeia, req.body.idEncaminhamentos, transaction);
        }
        return entrega.ID_Entrega;
      });
      return res.status(201).json({ message: "Entrega registrada!", idEntrega });
    } catch (error) {
      console.error("Erro ao criar entrega:", error);
      return res.status(500).json({ message: "Erro ao registrar a entrega." });
    }
  }

  /** Altera só os campos enviados: o formulário manda data, responsável e comentários; a tabela, só o status. */
  async editar(req: Request, res: Response): Promise<Response> {
    try {
      // Aprovar a entrega (mudar o status) é do administrador
      if (req.body.status !== undefined && req.sessao!.nivel !== "ADMIN") {
        return res.status(403).json({ message: "Apenas administradores mudam o status da entrega." });
      }
      const entrega = await Entrega.findByPk(String(req.params.id));
      if (!entrega) return res.status(404).json({ message: "Entrega não encontrada." });

      const campos: Record<string, unknown> = { Atualizado_Em: new Date() };
      if (req.body.dataEntrega !== undefined) {
        campos.Data_Entrega = dataISO(req.body.dataEntrega);
        if (!campos.Data_Entrega) return res.status(400).json({ message: "Informe a data da entrega." });
      }
      if (req.body.responsavel !== undefined) campos.Responsavel = texto(req.body.responsavel, 120);
      if (req.body.comentarios !== undefined) campos.Comentarios = texto(req.body.comentarios, 2000);
      if (req.body.status !== undefined) {
        if (!STATUS_ENTREGA.includes(req.body.status)) return res.status(400).json({ message: "Status inválido." });
        campos.Status = req.body.status;
      }

      await sequelize.transaction(async (transaction) => {
        await entrega.update(campos, { transaction });
        if (req.body.idEncaminhamentos !== undefined) {
          await vincularEntrega(entrega.ID_Entrega, entrega.ID_Ideia, req.body.idEncaminhamentos, transaction);
        }
      });
      return res.status(200).json({ message: "Entrega atualizada!", id: entrega.ID_Ideia });
    } catch (error) {
      console.error("Erro ao editar entrega:", error);
      return res.status(500).json({ message: "Erro ao atualizar a entrega." });
    }
  }

  /** O arquivo já foi gravado pelo multer (campo "arquivo"); aqui só registra na entrega. */
  async anexar(req: Request, res: Response): Promise<Response> {
    const arquivo = req.file;
    try {
      if (!arquivo) return res.status(400).json({ message: "Selecione o documento." });
      if (!arquivo.size) {
        await fs.rm(arquivo.path, { force: true });
        return res.status(400).json({ message: "O arquivo está vazio." });
      }
      const entrega = await Entrega.findByPk(String(req.params.id));
      if (!entrega || entrega.Anexo_Arquivo) {
        await fs.rm(arquivo.path, { force: true });
        return entrega
          ? res.status(400).json({ message: "Esta entrega já tem um documento. Exclua o atual antes de anexar outro." })
          : res.status(404).json({ message: "Entrega não encontrada." });
      }
      const agora = new Date();
      await entrega.update({
        Anexo_Arquivo: arquivo.filename,
        Anexo_Nome: nomeOriginal(arquivo),
        Anexo_Tipo: texto(arquivo.mimetype, 120) || "application/octet-stream",
        Anexo_Tamanho: arquivo.size,
        Anexo_Por: texto(req.sessao!.nome, 120),
        Anexo_Em: agora,
        Atualizado_Em: agora
      });
      return res.status(200).json({ message: "Documento anexado!", id: entrega.ID_Ideia });
    } catch (error) {
      if (arquivo) await fs.rm(arquivo.path, { force: true }).catch(() => undefined);
      console.error("Erro ao anexar documento:", error);
      return res.status(500).json({ message: "Erro ao anexar o documento." });
    }
  }

  async excluirAnexo(req: Request, res: Response): Promise<Response> {
    try {
      const entrega = await Entrega.findByPk(String(req.params.id));
      if (!entrega) return res.status(404).json({ message: "Entrega não encontrada." });
      if (!entrega.Anexo_Arquivo) return res.status(400).json({ message: "Esta entrega não tem documento anexado." });

      await fs.rm(caminhoDoAnexo(entrega.Anexo_Arquivo), { force: true });
      await entrega.update({
        Anexo_Arquivo: null, Anexo_Nome: null, Anexo_Tipo: null, Anexo_Tamanho: null, Anexo_Por: null, Anexo_Em: null,
        Atualizado_Em: new Date()
      });
      return res.status(200).json({ message: "Documento excluído.", id: entrega.ID_Ideia });
    } catch (error) {
      console.error("Erro ao excluir documento:", error);
      return res.status(500).json({ message: "Erro ao excluir o documento." });
    }
  }

  /** Qualquer usuário logado baixa, inclusive o perfil Leitura. */
  async baixarAnexo(req: Request, res: Response): Promise<Response | void> {
    try {
      const entrega = await Entrega.findByPk(String(req.params.id));
      if (!entrega || !entrega.Anexo_Arquivo) return res.status(404).json({ message: "Documento não encontrado." });
      const caminho = caminhoDoAnexo(entrega.Anexo_Arquivo);
      try {
        await fs.access(caminho);
      } catch {
        return res.status(404).json({ message: "O arquivo do documento não foi encontrado no servidor." });
      }
      if (entrega.Anexo_Tipo) res.type(entrega.Anexo_Tipo);
      return res.download(caminho, entrega.Anexo_Nome || path.basename(caminho));
    } catch (error) {
      console.error("Erro ao baixar documento:", error);
      return res.status(500).json({ message: "Erro ao baixar o documento." });
    }
  }
}

export default new EntregaController();
