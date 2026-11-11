import path from "path";
import fs from "fs";
import multer from "multer";

export const PASTA_UPLOADS = path.resolve(process.cwd(), "src", "uploads");
fs.mkdirSync(PASTA_UPLOADS, { recursive: true });

export const ANEXO_MAX_BYTES = 10 * 1024 * 1024;
export const ANEXO_EXTENSOES = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "txt", "csv", "rtf", "png", "jpg", "jpeg", "zip"];

/** O multer 1.x entrega o nome original em latin1: "relatÃ³rio" → "relatório". */
export const nomeOriginal = (file: Express.Multer.File) =>
  Buffer.from(file.originalname, "latin1").toString("utf8").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 200);

const extensao = (nome: string) => (nome.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";

export default multer({
  storage: multer.diskStorage({
    destination: PASTA_UPLOADS,
    // Nome no disco nunca vem do usuário: ID da entrega + data + extensão
    filename: (req, file, cb) => cb(null, `${req.params.id}-${Date.now()}.${extensao(nomeOriginal(file))}`)
  }),
  limits: { fileSize: ANEXO_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ANEXO_EXTENSOES.includes(extensao(nomeOriginal(file)))) return cb(null, true);
    cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "tipo"));
  }
});
