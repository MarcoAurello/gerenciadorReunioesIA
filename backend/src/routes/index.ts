import { Router, Request, Response } from "express";
import { sequelize } from "../models";
import authRoutes from "./auth.routes";
import resumoRoutes from "./resumo.routes";
import ideiaRoutes from "./ideia.routes";

const rotas = Router();

rotas.get("/", async (_req: Request, res: Response) => {
  try {
    await sequelize.query("SELECT 1");
    return res.status(200).json({ message: "API do Sistema de Apoio a Reuniões ativa." });
  } catch (error) {
    console.error("Erro ao conferir o banco:", error);
    return res.status(503).json({ message: "Banco de dados indisponível." });
  }
});

rotas.use("/auth", authRoutes);
rotas.use("/resumo", resumoRoutes);
rotas.use("/ideias", ideiaRoutes);

export default rotas;
