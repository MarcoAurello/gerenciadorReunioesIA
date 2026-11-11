import { Router } from "express";
import InteracaoController from "../controllers/InteracaoController";
import { autenticacao } from "../middlewares/autenticacao";
import { exigirLoginProprio } from "../middlewares/perfil";
import { confirmarSenha } from "../middlewares/confirmarSenha";

const router = Router();

router.use(autenticacao);

// Excluir: só os usuários autorizados (conferido no controller), sempre com a senha
router.delete("/:id", confirmarSenha, (req, res) => InteracaoController.excluir(req, res));
// Curtir: qualquer usuário com login próprio, inclusive o perfil Leitura
router.post("/:id/curtida", exigirLoginProprio, (req, res) => InteracaoController.curtir(req, res));

export default router;
