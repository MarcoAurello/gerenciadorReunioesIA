import { Request, Response } from "express";
import { Citacao } from "../models";
import { STATUS_CITACAO } from "../lib/constantes";

class CitacaoController {
  async atualizar(req: Request, res: Response): Promise<Response> {
    try {
      const sessao = req.sessao!;
      const status = String(req.body.status || "");
      if (!STATUS_CITACAO.includes(status)) return res.status(400).json({ message: "Status inválido." });

      const citacao = await Citacao.findByPk(String(req.params.id));
      if (!citacao) return res.status(404).json({ message: "Citação não encontrada." });
      if (sessao.nivel !== "ADMIN" && citacao.Apelido.toLowerCase() !== String(sessao.apelido).toLowerCase()) {
        return res.status(403).json({ message: "Só a pessoa citada pode alterar esta citação." });
      }
      await citacao.update({ Status: status, Atualizado_Em: new Date() });
      return res.status(200).json({ message: `Citação marcada como ${status.toLowerCase()}.`, id: citacao.ID_Ideia });
    } catch (error) {
      console.error("Erro ao atualizar citação:", error);
      return res.status(500).json({ message: "Erro ao atualizar a citação." });
    }
  }
}

export default new CitacaoController();
