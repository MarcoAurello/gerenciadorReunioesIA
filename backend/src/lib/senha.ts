import crypto from "crypto";
import bcrypt from "bcryptjs";

export const gerarHash = (senha: string) => bcrypt.hash(senha, 10);

/** Hash do protótipo (Apps Script não tinha bcrypt): "salt$hex", SHA-256 iterado 300 vezes. */
function hashAntigo(senha: string, salt: string): string {
  let h = salt + ":" + senha;
  for (let i = 0; i < 300; i++) h = crypto.createHash("sha256").update(h + salt, "utf8").digest("hex");
  return salt + "$" + h;
}

export const ehHashAntigo = (armazenado: string) => !/^\$2[aby]\$/.test(armazenado);

/** Aceita bcrypt e o hash antigo dos usuários importados da planilha. */
export async function conferirSenha(senha: string, armazenado: string | null): Promise<boolean> {
  const salvo = String(armazenado || "");
  if (!salvo) return false;
  if (!ehHashAntigo(salvo)) return bcrypt.compare(senha, salvo);
  const [salt] = salvo.split("$");
  if (!salt || salvo.split("$").length !== 2) return false;
  const calculado = Buffer.from(hashAntigo(senha, salt));
  const esperado = Buffer.from(salvo);
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

export function validarSenha(senha: unknown): string {
  const s = String(senha || "");
  if (s.length < 6) return "A senha deve ter pelo menos 6 caracteres.";
  if (s.length > 100) return "Senha muito longa.";
  return "";
}
