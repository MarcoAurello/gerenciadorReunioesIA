import { Router } from "express";
import ResumoController from "../controllers/ResumoController";
import { autenticacao } from "../middlewares/autenticacao";

const router = Router();

router.get("/", autenticacao, (req, res) => ResumoController.mostrar(req, res));

export default router;
