import { Request, Response } from "express";
import { Grupo, Recomendacao } from "../models";
import { novoId, texto } from "../lib/util";

/** null (todos os GTs) ou o ID de um GT existente; undefined se o GT não existir. */
async function grupoDaRecomendacao(idGrupo: unknown): Promise<string | null | undefined> {
  const id = String(idGrupo || "");
  if (!id) return null;
  return (await Grupo.findByPk(id)) ? id : undefined;
}

// Recomendações = "metadados da IA" na tela do administrador
class RecomendacaoController {
  async criar(req: Request, res: Response): Promise<Response> {
    try {
      const titulo = texto(req.body.titulo, 120);
      const conteudo = texto(req.body.texto, 2000);
      if (!titulo) return res.status(400).json({ message: "Informe o título do metadado." });
      if (!conteudo) return res.status(400).json({ message: "Escreva o texto do metadado." });
      const idGrupo = await grupoDaRecomendacao(req.body.idGrupo);
      if (idGrupo === undefined) return res.status(400).json({ message: "Grupo de trabalho não encontrado." });

      await Recomendacao.create({
        ID_Recomendacao: novoId("REC"),
        ID_Grupo: idGrupo,
        Titulo: titulo,
        Texto: conteudo,
        Ativo: true,
        Autor: texto(req.sessao!.nome, 120)
      });
      return res.status(201).json({ message: "Metadado cadastrado!" });
    } catch (error) {
      console.error("Erro ao criar recomendação:", error);
      return res.status(500).json({ message: "Erro ao cadastrar o metadado." });
    }
  }

  async editar(req: Request, res: Response): Promise<Response> {
    try {
      const rec = await Recomendacao.findByPk(String(req.params.id));
      if (!rec) return res.status(404).json({ message: "Metadado não encontrado." });

      const campos: Record<string, unknown> = { Atualizado_Em: new Date() };
      if (req.body.titulo !== undefined) {
        campos.Titulo = texto(req.body.titulo, 120);
        if (!campos.Titulo) return res.status(400).json({ message: "O título não pode ficar vazio." });
      }
      if (req.body.texto !== undefined) {
        campos.Texto = texto(req.body.texto, 2000);
        if (!campos.Texto) return res.status(400).json({ message: "O texto não pode ficar vazio." });
      }
      if (req.body.idGrupo !== undefined) {
        campos.ID_Grupo = await grupoDaRecomendacao(req.body.idGrupo);
        if (campos.ID_Grupo === undefined) return res.status(400).json({ message: "Grupo de trabalho não encontrado." });
      }
      if (req.body.ativo !== undefined) campos.Ativo = !!req.body.ativo;
      await rec.update(campos);

      const message = req.body.ativo === false ? "Metadado desativado." : req.body.ativo === true ? "Metadado reativado." : "Metadado atualizado!";
      return res.status(200).json({ message });
    } catch (error) {
      console.error("Erro ao editar recomendação:", error);
      return res.status(500).json({ message: "Erro ao atualizar o metadado." });
    }
  }

  async excluir(req: Request, res: Response): Promise<Response> {
    try {
      const apagadas = await Recomendacao.destroy({ where: { ID_Recomendacao: String(req.params.id) } });
      if (!apagadas) return res.status(404).json({ message: "Metadado não encontrado. Ele pode já ter sido excluído." });
      return res.status(200).json({ message: "Metadado excluído." });
    } catch (error) {
      console.error("Erro ao excluir recomendação:", error);
      return res.status(500).json({ message: "Erro ao excluir o metadado." });
    }
  }
}

export default new RecomendacaoController();
