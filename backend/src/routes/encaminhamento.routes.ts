import { Router } from "express";
import EncaminhamentoController from "../controllers/EncaminhamentoController";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteEscrita, somenteAdmin } from "../middlewares/perfil";
import { confirmarSenha } from "../middlewares/confirmarSenha";

const router = Router();

router.use(autenticacao);

router.put("/:id", somenteEscrita, (req, res) => EncaminhamentoController.atualizar(req, res));
// Excluir: só o administrador, com a senha
router.delete("/:id", somenteAdmin("Apenas administradores excluem encaminhamentos."), confirmarSenha,
  (req, res) => EncaminhamentoController.excluir(req, res));

export default router;
