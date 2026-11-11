import { Request, Response } from "express";
import { Usuario } from "../models";
import { PERFIS } from "../lib/constantes";
import { gerarApelido, normalizarTexto, novoId, texto } from "../lib/util";
import { gerarHash, validarSenha } from "../lib/senha";

const emailValido = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

class UsuarioController {
  async criar(req: Request, res: Response): Promise<Response> {
    try {
      const nome = texto(req.body.nome, 120);
      if (!nome) return res.status(400).json({ message: "Informe o nome." });
      const apelido = normalizarTexto(req.body.apelido || gerarApelido(nome)).replace(/\s+/g, "");
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(apelido)) {
        return res.status(400).json({ message: "Apelido inválido. Use letras, números, ponto ou hífen." });
      }
      if (apelido === "admin") return res.status(400).json({ message: "O apelido @admin é reservado." });
      const email = texto(req.body.email, 160).toLowerCase();
      if (email && !emailValido(email)) return res.status(400).json({ message: "E-mail inválido." });
      const perfil = PERFIS[req.body.perfil] ? req.body.perfil : "Colaborador";
      const problema = validarSenha(req.body.senha);
      if (problema) return res.status(400).json({ message: problema });

      if (await Usuario.findOne({ where: { Apelido: apelido } })) {
        return res.status(400).json({ message: `Já existe um usuário com o apelido @${apelido}.` });
      }
      await Usuario.create({
        ID_Usuario: novoId("USR"),
        Nome: nome,
        Apelido: apelido,
        Email: email || null,
        Perfil: perfil,
        Ativo: true,
        Senha_Hash: await gerarHash(String(req.body.senha))
      });
      return res.status(201).json({ message: `Usuário @${apelido} cadastrado!` });
    } catch (error) {
      console.error("Erro ao criar usuário:", error);
      return res.status(500).json({ message: "Erro ao cadastrar o usuário." });
    }
  }

  async editar(req: Request, res: Response): Promise<Response> {
    try {
      const usuario = await Usuario.findByPk(String(req.params.id));
      if (!usuario) return res.status(404).json({ message: "Usuário não encontrado." });

      const campos: Record<string, unknown> = {};
      if (req.body.nome !== undefined) {
        campos.Nome = texto(req.body.nome, 120);
        if (!campos.Nome) return res.status(400).json({ message: "O nome não pode ficar vazio." });
      }
      if (req.body.email !== undefined) {
        const email = texto(req.body.email, 160).toLowerCase();
        if (email && !emailValido(email)) return res.status(400).json({ message: "E-mail inválido." });
        campos.Email = email || null;
      }
      if (req.body.perfil !== undefined) {
        if (!PERFIS[req.body.perfil]) return res.status(400).json({ message: "Perfil inválido." });
        campos.Perfil = req.body.perfil;
      }
      if (req.body.ativo !== undefined) campos.Ativo = !!req.body.ativo;
      if (req.body.novaSenha !== undefined) {
        const problema = validarSenha(req.body.novaSenha);
        if (problema) return res.status(400).json({ message: problema });
        campos.Senha_Hash = await gerarHash(String(req.body.novaSenha));
      }
      await usuario.update(campos);
      return res.status(200).json({ message: req.body.novaSenha !== undefined ? "Senha redefinida!" : "Usuário atualizado!" });
    } catch (error) {
      console.error("Erro ao editar usuário:", error);
      return res.status(500).json({ message: "Erro ao atualizar o usuário." });
    }
  }
}

export default new UsuarioController();
