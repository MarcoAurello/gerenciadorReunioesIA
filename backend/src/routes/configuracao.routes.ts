import { Router } from "express";
import ConfiguracaoController from "../controllers/ConfiguracaoController";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteAdmin } from "../middlewares/perfil";
import { exigirSenha } from "../middlewares/confirmarSenha";

const router = Router();

router.use(autenticacao, somenteAdmin("Apenas administradores configuram a IA."));

router.get("/ia", (req, res) => ConfiguracaoController.mostrarIA(req, res));
// Trocar chaves exige a senha de quem está logado (campo "senha"), como as exclusões
router.put("/ia", exigirSenha("Senha incorreta. A configuração não foi salva."), (req, res) => ConfiguracaoController.salvarIA(req, res));
router.post("/ia/testar", (req, res) => ConfiguracaoController.testarIA(req, res));

export default router;
