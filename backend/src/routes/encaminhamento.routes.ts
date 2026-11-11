import { Router } from "express";
import EncaminhamentoController from "../controllers/EncaminhamentoController";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteEscrita } from "../middlewares/perfil";

const router = Router();

router.put("/:id", autenticacao, somenteEscrita, (req, res) => EncaminhamentoController.atualizar(req, res));

export default router;
