import { Router } from "express";
import InteracaoController from "../controllers/InteracaoController";
import { autenticacao } from "../middlewares/autenticacao";
import { exigirLoginProprio, somenteAdmin } from "../middlewares/perfil";
import { confirmarSenha } from "../middlewares/confirmarSenha";

const router = Router();

router.use(autenticacao);

// Excluir: só o administrador, sempre com a senha
router.delete("/:id", somenteAdmin("Apenas administradores excluem sugestões e comentários."), confirmarSenha, (req, res) => InteracaoController.excluir(req, res));
// Curtir: qualquer usuário com login próprio, inclusive o perfil Leitura
router.post("/:id/curtida", exigirLoginProprio, (req, res) => InteracaoController.curtir(req, res));

export default router;
