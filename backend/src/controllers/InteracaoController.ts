import { Request, Response } from "express";
import { Transaction } from "sequelize";
import { sequelize, Ideia, Interacao, Curtida, Citacao, Usuario } from "../models";
import { podeExcluirInteracoes } from "../lib/constantes";
import { novoId, texto } from "../lib/util";

/** Cria uma citação para cada @apelido de usuário ativo encontrado no texto. Devolve os apelidos citados. */
async function registrarCitacoes(idIdeia: string, idInteracao: string, autor: string, conteudo: string, transaction: Transaction) {
  const ativos = await Usuario.findAll({ where: { Ativo: true }, attributes: ["Apelido"], raw: true, transaction });
  const apelidos = new Set(ativos.map((u) => String(u.Apelido).toLowerCase()));

  const encontrados: string[] = [];
  for (const m of conteudo.matchAll(/@([a-z0-9._-]+)/gi)) {
    const apelido = m[1].toLowerCase().replace(/[.\-_]+$/, "");
    if (apelidos.has(apelido) && !encontrados.includes(apelido)) encontrados.push(apelido);
  }
  for (const apelido of encontrados) {
    await Citacao.create({
      ID_Citacao: novoId("CIT"),
      ID_Ideia: idIdeia,
      ID_Interacao: idInteracao,
      Apelido: apelido,
      Autor: autor,
      Trecho: conteudo.slice(0, 500),
      Status: "Pendente"
    }, { transaction });
  }
  return encontrados;
}

class InteracaoController {
  /** Sem idPai = nova sugestão na pauta; com idPai = comentário daquela sugestão. */
  async criar(req: Request, res: Response): Promise<Response> {
    try {
      const sessao = req.sessao!;
      const idIdeia = String(req.params.id);
      const idPai = req.body.idPai ? String(req.body.idPai) : null;
      // Comentar: qualquer usuário com login próprio, inclusive Leitura. Sugerir: colaborador ou administrador.
      if (!sessao.apelido && idPai) return res.status(403).json({ message: "Entre com o seu usuário para curtir ou comentar." });
      if (!idPai && sessao.nivel === "LEITURA") return res.status(403).json({ message: "Seu perfil é somente leitura." });

      if (!(await Ideia.findByPk(idIdeia))) return res.status(404).json({ message: "Pauta não encontrada." });
      const autor = texto(sessao.nome, 120);
      const conteudo = texto(req.body.texto, 5000);
      if (!conteudo) return res.status(400).json({ message: "Escreva o texto." });

      if (idPai) {
        const pai = await Interacao.findOne({ where: { ID_Interacao: idPai, ID_Ideia: idIdeia } });
        if (!pai || pai.Tipo !== "Sugestão") return res.status(404).json({ message: "Sugestão não encontrada." });
      }
      const tipo = idPai ? "Comentário" : "Sugestão";

      const citados = await sequelize.transaction(async (transaction) => {
        const interacao = await Interacao.create(
          { ID_Interacao: novoId("INT"), ID_Ideia: idIdeia, ID_Pai: idPai, Tipo: tipo, Autor: autor, Texto: conteudo },
          { transaction }
        );
        return registrarCitacoes(idIdeia, interacao.ID_Interacao, autor, conteudo, transaction);
      });

      const extra = citados.length ? " " + citados.map((a) => "@" + a).join(", ") + " notificado(s)." : "";
      return res.status(201).json({ message: (tipo === "Sugestão" ? "Sugestão registrada!" : "Comentário registrado!") + extra });
    } catch (error) {
      console.error("Erro ao registrar interação:", error);
      return res.status(500).json({ message: "Erro ao registrar o texto." });
    }
  }

  /** Exclui uma sugestão (com seus comentários) ou um comentário; citações e curtidas caem junto (FK em cascata). */
  async excluir(req: Request, res: Response): Promise<Response> {
    try {
      if (!podeExcluirInteracoes(req.sessao!)) {
        return res.status(403).json({ message: "Você não tem permissão para excluir sugestões e comentários." });
      }
      const alvo = await Interacao.findByPk(String(req.params.id));
      if (!alvo) return res.status(404).json({ message: "Registro não encontrado. Ele pode já ter sido excluído." });

      const qtdComentarios = alvo.Tipo === "Sugestão" ? await Interacao.count({ where: { ID_Pai: alvo.ID_Interacao } }) : 0;
      await alvo.destroy();
      return res.status(200).json({
        id: alvo.ID_Ideia,
        message: alvo.Tipo === "Sugestão"
          ? "Sugestão excluída" + (qtdComentarios ? ` com ${qtdComentarios} comentário(s).` : ".")
          : "Comentário excluído."
      });
    } catch (error) {
      console.error("Erro ao excluir interação:", error);
      return res.status(500).json({ message: "Erro ao excluir." });
    }
  }

  /** Curte a sugestão ou, se o usuário já curtiu, desfaz a curtida (uma por usuário). */
  async curtir(req: Request, res: Response): Promise<Response> {
    try {
      const sessao = req.sessao!;
      const sugestao = await Interacao.findByPk(String(req.params.id));
      if (!sugestao || sugestao.Tipo !== "Sugestão" || sugestao.ID_Pai) {
        return res.status(404).json({ message: "Sugestão não encontrada." });
      }
      const apelido = String(sessao.apelido).toLowerCase();
      const removidas = await Curtida.destroy({ where: { ID_Interacao: sugestao.ID_Interacao, Apelido: apelido } });
      if (removidas) return res.status(200).json({ message: "Curtida removida.", curtiu: false, id: sugestao.ID_Ideia });

      await Curtida.create({
        ID_Curtida: novoId("CUR"),
        ID_Ideia: sugestao.ID_Ideia,
        ID_Interacao: sugestao.ID_Interacao,
        Apelido: apelido,
        Nome: texto(sessao.nome, 120)
      });
      return res.status(201).json({ message: "Sugestão curtida!", curtiu: true, id: sugestao.ID_Ideia });
    } catch (error) {
      console.error("Erro ao curtir:", error);
      return res.status(500).json({ message: "Erro ao registrar a curtida." });
    }
  }
}

export default new InteracaoController();
