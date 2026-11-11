import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import authConfig from "../config/auth";
import { Usuario } from "../models";
import { PERFIS, Sessao } from "../lib/constantes";
import { tokenEncerrado } from "../lib/memoria";

// O frontend volta para a tela de login quando recebe codigo "SESSAO"
const expirou = (res: Response) =>
  res.status(401).json({ codigo: "SESSAO", message: "Sua sessão expirou. Entre novamente." });

export const tokenDaRequisicao = (req: Request) => {
  const [tipo, token] = String(req.headers.authorization || "").split(" ");
  return tipo === "Bearer" && token ? token : "";
};

/** Valida o token e revalida o usuário: desativação e troca de perfil valem na hora. */
export async function autenticacao(req: Request, res: Response, next: NextFunction) {
  const token = tokenDaRequisicao(req);
  if (!token || tokenEncerrado(token)) return expirou(res);

  let sessao: Sessao;
  try {
    const p = jwt.verify(token, authConfig.secret) as Sessao;
    sessao = { apelido: p.apelido, nome: p.nome, nivel: p.nivel };
  } catch {
    return expirou(res);
  }

  try {
    if (sessao.apelido && sessao.apelido !== "admin") {
      const u = await Usuario.findOne({ where: { Apelido: sessao.apelido, Ativo: true } });
      if (!u) return expirou(res);
      sessao.nome = u.Nome;
      sessao.nivel = PERFIS[u.Perfil];
    }
    req.sessao = sessao;
    return next();
  } catch (error) {
    console.error("Erro ao validar a sessão:", error);
    return res.status(500).json({ message: "Erro ao validar a sessão." });
  }
}
