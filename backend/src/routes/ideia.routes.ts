import { Router } from "express";
import IdeiaController from "../controllers/IdeiaController";
import InteracaoController from "../controllers/InteracaoController";
import EncaminhamentoController from "../controllers/EncaminhamentoController";
import EntregaController from "../controllers/EntregaController";
import IAController from "../controllers/IAController";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteEscrita } from "../middlewares/perfil";
import { confirmarSenhaIA } from "../middlewares/confirmarSenha";

const router = Router();

router.use(autenticacao);

router.post("/", somenteEscrita, (req, res) => IdeiaController.criar(req, res));
router.get("/:id", (req, res) => IdeiaController.detalhe(req, res));
router.put("/:id", somenteEscrita, (req, res) => IdeiaController.editar(req, res));

// Sugestão (colaborador) ou comentário (qualquer login próprio): a regra fica no controller
router.post("/:id/interacoes", (req, res) => InteracaoController.criar(req, res));
router.post("/:id/encaminhamentos", somenteEscrita, (req, res) => EncaminhamentoController.criar(req, res));
router.post("/:id/entregas", somenteEscrita, (req, res) => EntregaController.criar(req, res));
router.post("/:id/ia/encaminhamentos", somenteEscrita, confirmarSenhaIA, (req, res) => IAController.sugerirEncaminhamentos(req, res));

export default router;
