import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import authConfig from "../config/auth";
import { Usuario } from "../models";
import { PERFIS, Sessao } from "../lib/constantes";
import { normalizarTexto } from "../lib/util";
import { conferirSenha, gerarHash, validarSenha } from "../lib/senha";
import { bloqueado, registrarFalha, limparFalhas, encerrarToken } from "../lib/memoria";
import { MSG_BLOQUEIO, senhaDoUsuarioConfere } from "../middlewares/confirmarSenha";
import { tokenDaRequisicao } from "../middlewares/autenticacao";
import ResumoController from "./ResumoController";

class AuthController {
  /**
   * @apelido + senha própria. Sem apelido = observador (SENHA_LEITURA);
   * "admin" = primeiro acesso (SENHA_ADMIN).
   */
  async login(req: Request, res: Response): Promise<Response> {
    try {
      const apelido = normalizarTexto(req.body.usuario || "").replace(/^@/, "").replace(/\s+/g, "");
      const senha = String(req.body.senha || "");
      if (!senha) return res.status(400).json({ message: "Informe a senha." });

      const chave = apelido || "_observador";
      if (bloqueado(chave)) return res.status(429).json({ message: MSG_BLOQUEIO });

      let sessao: Sessao | null = null;
      if (!apelido) {
        const senhaObs = authConfig.senhaLeitura; // vazia = acesso de observador desligado
        if (senhaObs && senhaObs.toLowerCase() !== "desativado" && senha === senhaObs) {
          sessao = { apelido: "", nome: "Observador", nivel: "LEITURA" };
        }
      } else if (apelido === "admin") {
        if (authConfig.senhaAdmin && senha === authConfig.senhaAdmin) {
          sessao = { apelido: "admin", nome: "Administrador", nivel: "ADMIN" };
        }
      } else {
        const u = await Usuario.findOne({ where: { Apelido: apelido, Ativo: true } });
        if (u && (await senhaDoUsuarioConfere(u, senha))) {
          sessao = { apelido: u.Apelido, nome: u.Nome, nivel: PERFIS[u.Perfil] };
        }
      }

      if (!sessao) {
        registrarFalha(chave);
        return res.status(401).json({ message: apelido ? "Usuário ou senha inválidos." : "Senha de observador inválida." });
      }
      limparFalhas(chave);

      const token = jwt.sign(sessao, authConfig.secret, { expiresIn: authConfig.expiresIn } as jwt.SignOptions);
      // Já devolve os dados da carga inicial: uma requisição a menos no login
      const resumo = await ResumoController.montarResumo(sessao);
      return res.status(200).json({ message: "Login realizado.", token, ...resumo });
    } catch (error) {
      console.error("Erro no login:", error);
      return res.status(500).json({ message: "Erro ao entrar. Tente novamente." });
    }
  }

  /** O JWT não tem estado: o token encerrado fica numa lista até expirar. */
  async logout(req: Request, res: Response): Promise<Response> {
    const token = tokenDaRequisicao(req);
    const p = jwt.decode(token) as { exp?: number } | null;
    encerrarToken(token, (p?.exp || 0) * 1000);
    return res.status(200).json({ message: "Sessão encerrada." });
  }

  async alterarSenha(req: Request, res: Response): Promise<Response> {
    try {
      const sessao = req.sessao!;
      if (!sessao.apelido) return res.status(400).json({ message: "O acesso de observador não tem senha própria." });
      if (sessao.apelido === "admin") {
        return res.status(400).json({ message: "A senha do admin é alterada no servidor (SENHA_ADMIN no .env)." });
      }
      const u = await Usuario.findOne({ where: { Apelido: sessao.apelido } });
      if (!u || !(await conferirSenha(String(req.body.senhaAtual || ""), u.Senha_Hash))) {
        return res.status(400).json({ message: "Senha atual incorreta." });
      }
      const problema = validarSenha(req.body.novaSenha);
      if (problema) return res.status(400).json({ message: problema });

      await u.update({ Senha_Hash: await gerarHash(String(req.body.novaSenha)) });
      return res.status(200).json({ message: "Senha alterada!" });
    } catch (error) {
      console.error("Erro ao alterar a senha:", error);
      return res.status(500).json({ message: "Erro ao alterar a senha." });
    }
  }
}

export default new AuthController();
