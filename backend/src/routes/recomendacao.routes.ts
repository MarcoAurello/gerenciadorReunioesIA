import { Router } from "express";
import RecomendacaoController from "../controllers/RecomendacaoController";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteAdmin } from "../middlewares/perfil";
import { confirmarSenha } from "../middlewares/confirmarSenha";

const router = Router();

router.use(autenticacao, somenteAdmin("Apenas administradores gerenciam os metadados da IA."));

router.post("/", (req, res) => RecomendacaoController.criar(req, res));
router.put("/:id", (req, res) => RecomendacaoController.editar(req, res));
router.delete("/:id", confirmarSenha, (req, res) => RecomendacaoController.excluir(req, res));

export default router;
