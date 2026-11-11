import { Router } from "express";
import AuthController from "../controllers/AuthController";
import { autenticacao } from "../middlewares/autenticacao";

const router = Router();

router.post("/login", (req, res) => AuthController.login(req, res));
router.post("/logout", autenticacao, (req, res) => AuthController.logout(req, res));
router.put("/senha", autenticacao, (req, res) => AuthController.alterarSenha(req, res));

export default router;
