export function texto(valor: unknown, max: number): string {
  return String(valor === undefined || valor === null ? "" : valor).trim().slice(0, max);
}

/** "Título da Pauta" → "titulodapauta" */
export function normalizar(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizarTexto(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9.\s_-]/g, "").trim();
}

/** "Marco Aurélio Nunes" → "marco.nunes" */
export function gerarApelido(nome: string): string {
  const partes = normalizarTexto(nome).split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  return partes.length === 1 ? partes[0] : partes[0] + "." + partes[partes.length - 1];
}

/** Data de hoje (yyyy-mm-dd) no fuso de Recife. */
export function hojeISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Recife" }).format(new Date());
}

/** "yyyy-mm-dd" válido ou null. */
export function dataISO(valor: unknown): string | null {
  const v = texto(valor, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

let ultimoId = 0;
/** "IDEIA-1731340000000", como o protótipo; nunca repete no mesmo processo. */
export function novoId(prefixo: string): string {
  ultimoId = Math.max(Date.now(), ultimoId + 1);
  return prefixo + "-" + ultimoId;
}

/** Campos nulos viram "" (a planilha nunca devolvia null e o frontend conta com isso). */
export function paraApi<T extends Record<string, any>>(linha: T): T {
  const saida: Record<string, any> = {};
  for (const [k, v] of Object.entries(linha)) saida[k] = v === null || v === undefined ? "" : v;
  return saida as T;
}
