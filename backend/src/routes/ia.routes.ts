import { Router } from "express";
import IAController from "../controllers/IAController";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteEscrita } from "../middlewares/perfil";
import { confirmarSenhaIA } from "../middlewares/confirmarSenha";

const router = Router();

// A sugestão de encaminhamentos fica em POST /ideias/:id/ia/encaminhamentos
router.post("/pautas", autenticacao, somenteEscrita, confirmarSenhaIA, (req, res) => IAController.sugerirPautas(req, res));

export default router;
