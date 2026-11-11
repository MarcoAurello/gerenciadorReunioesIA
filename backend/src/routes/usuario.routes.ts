import { Router } from "express";
import UsuarioController from "../controllers/UsuarioController";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteAdmin } from "../middlewares/perfil";

const router = Router();

router.use(autenticacao, somenteAdmin("Apenas administradores gerenciam usuários."));

router.post("/", (req, res) => UsuarioController.criar(req, res));
router.put("/:id", (req, res) => UsuarioController.editar(req, res));

export default router;
