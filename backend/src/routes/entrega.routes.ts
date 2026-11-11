import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import EntregaController from "../controllers/EntregaController";
import upload, { ANEXO_EXTENSOES } from "../config/upload";
import { autenticacao } from "../middlewares/autenticacao";
import { somenteEscrita } from "../middlewares/perfil";
import { confirmarSenha } from "../middlewares/confirmarSenha";

const router = Router();

/** Recebe o campo "arquivo" e traduz os erros do multer em mensagens para o usuário. */
function receberArquivo(req: Request, res: Response, next: NextFunction) {
  upload.single("arquivo")(req, res, (erro: unknown) => {
    if (!erro) return next();
    if (erro instanceof multer.MulterError && erro.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "O arquivo passa de 10 MB." });
    }
    if (erro instanceof multer.MulterError) {
      return res.status(400).json({ message: `Tipo de arquivo não aceito. Envie: ${ANEXO_EXTENSOES.join(", ")}.` });
    }
    console.error("Erro ao receber arquivo:", erro);
    return res.status(500).json({ message: "Erro ao receber o arquivo." });
  });
}

router.use(autenticacao);

router.put("/:id", somenteEscrita, (req, res) => EntregaController.editar(req, res));
// Baixar o documento: qualquer usuário logado, inclusive o perfil Leitura
router.get("/:id/anexo", (req, res) => EntregaController.baixarAnexo(req, res));
router.post("/:id/anexo", somenteEscrita, receberArquivo, (req, res) => EntregaController.anexar(req, res));
router.delete("/:id/anexo", somenteEscrita, confirmarSenha, (req, res) => EntregaController.excluirAnexo(req, res));

export default router;
