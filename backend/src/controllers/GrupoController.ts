import { Request, Response } from "express";
import { Op } from "sequelize";
import { Grupo } from "../models";
import { normalizar, novoId, texto } from "../lib/util";

/** Já existe outro grupo com o mesmo nome (ignorando acentos e maiúsculas)? */
async function nomeRepetido(nome: string, ignorarId = "") {
  const outros = await Grupo.findAll({ where: { ID_Grupo: { [Op.ne]: ignorarId } }, attributes: ["Nome"], raw: true });
  return outros.some((g) => normalizar(g.Nome) === normalizar(nome));
}

class GrupoController {
  async criar(req: Request, res: Response): Promise<Response> {
    try {
      const nome = texto(req.body.nome, 80);
      if (!nome) return res.status(400).json({ message: "Informe o nome do grupo de trabalho." });
      if (await nomeRepetido(nome)) return res.status(400).json({ message: `Já existe um grupo de trabalho chamado "${nome}".` });

      const grupo = await Grupo.create({ ID_Grupo: novoId("GT"), Nome: nome, Descricao: texto(req.body.descricao, 500), Ativo: true });
      return res.status(201).json({ message: `Grupo "${nome}" criado!`, idGrupo: grupo.ID_Grupo });
    } catch (error) {
      console.error("Erro ao criar grupo:", error);
      return res.status(500).json({ message: "Erro ao criar o grupo de trabalho." });
    }
  }

  async editar(req: Request, res: Response): Promise<Response> {
    try {
      const grupo = await Grupo.findByPk(String(req.params.id));
      if (!grupo) return res.status(404).json({ message: "Grupo de trabalho não encontrado." });

      const campos: Record<string, unknown> = {};
      if (req.body.nome !== undefined) {
        const nome = texto(req.body.nome, 80);
        if (!nome) return res.status(400).json({ message: "O nome não pode ficar vazio." });
        if (await nomeRepetido(nome, grupo.ID_Grupo)) return res.status(400).json({ message: "Já existe um grupo de trabalho com esse nome." });
        campos.Nome = nome;
      }
      if (req.body.descricao !== undefined) campos.Descricao = texto(req.body.descricao, 500);
      if (req.body.ativo !== undefined) campos.Ativo = !!req.body.ativo;
      await grupo.update(campos);

      const message = req.body.ativo === false ? "Grupo desativado." : req.body.ativo === true ? "Grupo reativado." : "Grupo atualizado!";
      return res.status(200).json({ message });
    } catch (error) {
      console.error("Erro ao editar grupo:", error);
      return res.status(500).json({ message: "Erro ao atualizar o grupo de trabalho." });
    }
  }
}

export default new GrupoController();
