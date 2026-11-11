import { Request, Response, NextFunction } from "express";
import { Nivel } from "../lib/constantes";

/** Libera a rota só para os níveis informados. Use depois do middleware de autenticação. */
export const exigirNivel = (niveis: Nivel[], message: string) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.sessao || !niveis.includes(req.sessao.nivel)) return res.status(403).json({ message });
    return next();
  };

export const somenteEscrita = exigirNivel(["ADMIN", "ESCRITA"], "Seu perfil é somente leitura.");
export const somenteAdmin = (message: string) => exigirNivel(["ADMIN"], message);

/** Curtir e comentar exigem login próprio (o observador sem cadastro não pode). */
export function exigirLoginProprio(req: Request, res: Response, next: NextFunction) {
  if (!req.sessao?.apelido) return res.status(403).json({ message: "Entre com o seu usuário para curtir ou comentar." });
  return next();
}
