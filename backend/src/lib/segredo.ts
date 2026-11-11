import crypto from "crypto";
import authConfig from "../config/auth";

/*
 * Cifra os segredos gravados no banco (AES-256-GCM). A chave da cifra vem do JWT_SECRET:
 * quem copiar o banco sem o .env do servidor não lê as chaves. Se o JWT_SECRET mudar,
 * os segredos antigos não abrem mais e precisam ser cadastrados de novo.
 */
const chaveDaCifra = () => crypto.createHash("sha256").update(`${authConfig.secret}:configuracoes`).digest();

/** "v1:iv:tag:conteudo", tudo em base64. */
export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv("aes-256-gcm", chaveDaCifra(), iv);
  const conteudo = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return ["v1", iv.toString("base64"), cifra.getAuthTag().toString("base64"), conteudo.toString("base64")].join(":");
}

/** Texto original, ou null se o valor estiver corrompido ou cifrado com outro JWT_SECRET. */
export function decifrar(valor: string): string | null {
  try {
    const [versao, iv, tag, conteudo] = valor.split(":");
    if (versao !== "v1") return null;
    const decifra = crypto.createDecipheriv("aes-256-gcm", chaveDaCifra(), Buffer.from(iv, "base64"));
    decifra.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decifra.update(Buffer.from(conteudo, "base64")), decifra.final()]).toString("utf8");
  } catch {
    return null;
  }
}
