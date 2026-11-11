import { Router, Request, Response } from "express";
import { sequelize } from "../models";
import authRoutes from "./auth.routes";
import resumoRoutes from "./resumo.routes";
import ideiaRoutes from "./ideia.routes";
import interacaoRoutes from "./interacao.routes";
import encaminhamentoRoutes from "./encaminhamento.routes";
import entregaRoutes from "./entrega.routes";
import citacaoRoutes from "./citacao.routes";
import usuarioRoutes from "./usuario.routes";
import grupoRoutes from "./grupo.routes";
import recomendacaoRoutes from "./recomendacao.routes";
import iaRoutes from "./ia.routes";
import configuracaoRoutes from "./configuracao.routes";

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
rotas.use("/interacoes", interacaoRoutes);
rotas.use("/encaminhamentos", encaminhamentoRoutes);
rotas.use("/entregas", entregaRoutes);
rotas.use("/citacoes", citacaoRoutes);
rotas.use("/usuarios", usuarioRoutes);
rotas.use("/grupos", grupoRoutes);
rotas.use("/recomendacoes", recomendacaoRoutes);
rotas.use("/ia", iaRoutes);
rotas.use("/configuracoes", configuracaoRoutes);

export default rotas;
