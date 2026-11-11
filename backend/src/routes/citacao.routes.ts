import { Router } from "express";
import CitacaoController from "../controllers/CitacaoController";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteEscrita } from "../middlewares/perfil";

const router = Router();

router.put("/:id", autenticacao, somenteEscrita, (req, res) => CitacaoController.atualizar(req, res));

export default router;
