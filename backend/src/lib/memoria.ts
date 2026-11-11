import authConfig from "../config/auth";

/*
 * Estado guardado na memória do processo (a API roda em um único contêiner):
 * tentativas de senha erradas e tokens encerrados pelo botão Sair.
 * Reiniciar a API zera os dois, o que é aceitável para ambos.
 */

const falhas = new Map<string, { qtd: number; ate: number }>();

export function bloqueado(chave: string): boolean {
  const f = falhas.get(chave);
  if (f && f.ate < Date.now()) falhas.delete(chave);
  return (falhas.get(chave)?.qtd || 0) >= authConfig.maxTentativas;
}

export function registrarFalha(chave: string): void {
  const qtd = (falhas.get(chave)?.qtd || 0) + 1;
  falhas.set(chave, { qtd, ate: Date.now() + authConfig.bloqueioSegundos * 1000 });
}

export const limparFalhas = (chave: string) => falhas.delete(chave);

const encerrados = new Map<string, number>(); // token → quando expira (ms)

export function encerrarToken(token: string, expiraEm: number): void {
  encerrados.set(token, expiraEm);
  const agora = Date.now();
  for (const [t, exp] of encerrados) if (exp < agora) encerrados.delete(t);
}

export const tokenEncerrado = (token: string) => encerrados.has(token);
