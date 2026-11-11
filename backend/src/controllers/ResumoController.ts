import { Request, Response } from "express";
import { Grupo, Usuario, Ideia, Interacao, Citacao, Encaminhamento, Entrega, Recomendacao } from "../models";
import {
  Sessao, PERFIS, STATUS_IDEIA, TIPOS_INTERACAO, STATUS_ENCAMINHAMENTO, STATUS_CITACAO, STATUS_ENTREGA,
  podeExcluirInteracoes
} from "../lib/constantes";
import { hojeISO, normalizar, paraApi } from "../lib/util";

const LIMITE_DESCRICAO_RESUMO = 300;
const ABERTOS = ["Pendente", "Em Andamento"];

type Contador = { sug: number; com: number; enc: number; abertos: number; atrasados: number; concluidos: number; ent: number; entAprovadas: number };

class ResumoController {
  /**
   * Carga inicial leve: pautas com contadores (sem as sugestões, comentários e
   * encaminhamentos em si), grupos, usuários e as citações de quem está logado.
   * O conteúdo de cada pauta vem sob demanda em GET /ideias/:id.
   */
  async montarResumo(sessao: Sessao) {
    const nivel = sessao.nivel;
    const hoje = hojeISO();

    const [interacoes, encaminhamentos, entregas, ideias, grupos, usuarios] = await Promise.all([
      Interacao.findAll({ attributes: ["ID_Ideia", "ID_Pai", "Tipo"], raw: true }),
      Encaminhamento.findAll({ attributes: ["ID_Encaminhamento", "ID_Ideia", "Acao", "Responsavel", "Prazo", "Status"], raw: true }),
      Entrega.findAll({ attributes: ["ID_Ideia", "Status"], raw: true }),
      Ideia.findAll({ order: [["Data_Criacao", "ASC"]], raw: true }),
      Grupo.findAll({ order: [["Data_Criacao", "ASC"]], raw: true }),
      Usuario.findAll({ order: [["Nome", "ASC"]], raw: true })
    ]);

    const cont: Record<string, Contador> = {};
    const de = (id: string) =>
      cont[id] || (cont[id] = { sug: 0, com: 0, enc: 0, abertos: 0, atrasados: 0, concluidos: 0, ent: 0, entAprovadas: 0 });

    interacoes.forEach((i) => {
      const c = de(i.ID_Ideia);
      if (i.Tipo === "Sugestão" && !i.ID_Pai) c.sug++; else c.com++;
    });
    encaminhamentos.forEach((e) => {
      const c = de(e.ID_Ideia);
      c.enc++;
      if (ABERTOS.includes(e.Status)) {
        c.abertos++;
        if (e.Prazo && e.Prazo < hoje) c.atrasados++;
      } else if (e.Status === "Concluído") {
        c.concluidos++;
      }
    });
    entregas.forEach((e) => {
      const c = de(e.ID_Ideia);
      c.ent++;
      if (e.Status === "Aprovado") c.entAprovadas++;
    });

    const listaIdeias = ideias.map((i) => {
      const c = de(i.ID_Ideia);
      const desc = String(i.Descricao || "");
      return paraApi({
        ...i,
        Descricao: desc.slice(0, LIMITE_DESCRICAO_RESUMO),
        Descricao_Completa: desc.length <= LIMITE_DESCRICAO_RESUMO,
        Qtd_Sugestoes: c.sug,
        Qtd_Comentarios: c.com,
        Qtd_Encaminhamentos: c.enc,
        Qtd_Abertos: c.abertos,
        Qtd_Atrasados: c.atrasados,
        Qtd_Concluidos: c.concluidos,
        Qtd_Entregas: c.ent,
        Qtd_Entregas_Aprovadas: c.entAprovadas
      });
    });

    const meu = String(sessao.apelido || "").toLowerCase();
    const ehPessoa = !!meu && meu !== "admin";
    const citacoes = ehPessoa
      ? await Citacao.findAll({ where: { Apelido: meu }, order: [["Data", "ASC"]], raw: true })
      : [];
    // Encaminhamentos em aberto em que o responsável sou eu (pelo nome ou pelo @apelido), em todos os GTs
    const meusNomes = ehPessoa ? [normalizar(sessao.nome), normalizar(meu)] : [];
    const meusEncaminhamentos = encaminhamentos
      .filter((e) => {
        const resp = normalizar(e.Responsavel);
        return resp && meusNomes.includes(resp) && ABERTOS.includes(e.Status);
      })
      .map((e) => paraApi({ ID_Encaminhamento: e.ID_Encaminhamento, ID_Ideia: e.ID_Ideia, Acao: e.Acao, Prazo: e.Prazo, Status: e.Status }));

    return {
      nivelAcesso: nivel,
      usuario: { nome: sessao.nome, apelido: sessao.apelido, nivel, podeExcluirInteracoes: podeExcluirInteracoes(sessao) },
      hoje,
      dados: {
        ideias: listaIdeias,
        // GTs desativados só aparecem para o administrador (que pode reativá-los)
        grupos: grupos.filter((g) => nivel === "ADMIN" || g.Ativo).map(paraApi),
        usuarios: usuarios.map((u) => {
          // Hash nunca sai do servidor; e-mail e perfil só para administradores
          const pub: Record<string, unknown> = { ID_Usuario: u.ID_Usuario, Nome: u.Nome, Apelido: u.Apelido, Ativo: u.Ativo };
          if (nivel === "ADMIN") {
            pub.Email = u.Email;
            pub.Perfil = u.Perfil;
            pub.Tem_Senha = !!u.Senha_Hash;
          }
          return paraApi(pub);
        }),
        citacoes: citacoes.map(paraApi),
        meusEncaminhamentos,
        // Só o administrador cadastra e vê as recomendações da IA
        recomendacoes: nivel === "ADMIN"
          ? (await Recomendacao.findAll({ order: [["Data_Criacao", "ASC"]], raw: true })).map(paraApi)
          : []
      },
      listas: { STATUS_IDEIA, TIPOS_INTERACAO, STATUS_ENCAMINHAMENTO, STATUS_CITACAO, STATUS_ENTREGA, PERFIS: Object.keys(PERFIS) }
    };
  }

  async mostrar(req: Request, res: Response): Promise<Response> {
    try {
      const resumo = await this.montarResumo(req.sessao!);
      return res.status(200).json({ message: "Dados carregados.", ...resumo });
    } catch (error) {
      console.error("Erro ao carregar o resumo:", error);
      return res.status(500).json({ message: "Erro ao carregar os dados." });
    }
  }
}

export default new ResumoController();
