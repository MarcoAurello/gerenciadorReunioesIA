import { Request, Response, NextFunction } from "express";
import authConfig from "../config/auth";
import { Usuario } from "../models";
import { Sessao } from "../lib/constantes";
import { conferirSenha, ehHashAntigo, gerarHash } from "../lib/senha";
import { bloqueado, registrarFalha, limparFalhas } from "../lib/memoria";

export const MSG_BLOQUEIO = "Muitas tentativas incorretas. Aguarde 10 minutos e tente novamente.";

/** Confere a senha do usuário e troca o hash antigo da planilha por bcrypt no primeiro acerto. */
export async function senhaDoUsuarioConfere(u: Usuario, senha: string): Promise<boolean> {
  if (!(await conferirSenha(senha, u.Senha_Hash))) return false;
  if (u.Senha_Hash && ehHashAntigo(u.Senha_Hash)) await u.update({ Senha_Hash: await gerarHash(senha) });
  return true;
}

/**
 * Confere a senha de quem está logado. Devolve a mensagem de erro, ou "" se confere.
 * Erros contam para o mesmo bloqueio do login.
 */
export async function verificarSenhaDaSessao(sessao: Sessao, senhaInformada: unknown, msgErro: string): Promise<string> {
  const senha = String(senhaInformada || "");
  if (!senha) return "Digite a sua senha para confirmar.";
  const apelido = String(sessao.apelido || "").toLowerCase();
  if (!apelido) return "O acesso de observador não tem senha própria.";
  if (bloqueado(apelido)) return MSG_BLOQUEIO;

  let confere = false;
  if (apelido === "admin") {
    confere = !!authConfig.senhaAdmin && senha === authConfig.senhaAdmin;
  } else {
    const u = await Usuario.findOne({ where: { Apelido: apelido } });
    confere = !!u && (await senhaDoUsuarioConfere(u, senha));
  }
  if (!confere) {
    registrarFalha(apelido);
    return msgErro;
  }
  limparFalhas(apelido);
  return "";
}

/** Toda exclusão exige a senha de quem está logado (campo "senha" no corpo). */
export async function confirmarSenha(req: Request, res: Response, next: NextFunction) {
  try {
    const falha = await verificarSenhaDaSessao(req.sessao!, req.body?.senha, "Senha incorreta. A exclusão não foi feita.");
    if (falha) return res.status(403).json({ message: falha });
    return next();
  } catch (error) {
    console.error("Erro ao confirmar a senha:", error);
    return res.status(500).json({ message: "Erro ao confirmar a senha." });
  }
}

/** Botões de IA: mesma conferência, com o código que faz o frontend pedir a senha de novo. */
export async function confirmarSenhaIA(req: Request, res: Response, next: NextFunction) {
  try {
    const falha = await verificarSenhaDaSessao(req.sessao!, req.body?.senhaIA, "Senha incorreta.");
    if (falha) return res.status(403).json({ codigo: "SENHA_IA", message: falha });
    return next();
  } catch (error) {
    console.error("Erro ao confirmar a senha da IA:", error);
    return res.status(500).json({ message: "Erro ao confirmar a senha." });
  }
}
