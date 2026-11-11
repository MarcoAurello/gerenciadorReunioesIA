import { Router } from "express";
import GrupoController from "../controllers/GrupoController";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteAdmin } from "../middlewares/perfil";

const router = Router();

router.use(autenticacao, somenteAdmin("Apenas administradores gerenciam os grupos de trabalho."));

router.post("/", (req, res) => GrupoController.criar(req, res));
router.put("/:id", (req, res) => GrupoController.editar(req, res));

export default router;
