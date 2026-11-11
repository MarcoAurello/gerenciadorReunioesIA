import { Router } from "express";
import IdeiaController from "../controllers/IdeiaController";
import { autenticacao } from "../middlewares/autenticacao";

const router = Router();

router.use(autenticacao);
router.get("/:id", (req, res) => IdeiaController.detalhe(req, res));

export default router;
