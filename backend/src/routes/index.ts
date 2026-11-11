import { Router, Request, Response } from "express";
import { sequelize } from "../models";

const rotas = Router();

// Mesmo retorno do doGet() do protótipo, com a conferência do banco
rotas.get("/", async (_req: Request, res: Response) => {
  try {
    await sequelize.query("SELECT 1");
    return res.status(200).json({ status: "success", message: "API do Sistema de Apoio a Reuniões ativa." });
  } catch (error) {
    console.error("Erro ao conferir o banco:", error);
    return res.status(503).json({ status: "error", message: "Banco de dados indisponível." });
  }
});

// POST /api com { acao, token, ... }: o despachante das ações vem no próximo passo

export default rotas;
