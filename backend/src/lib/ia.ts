/*
 * Inteligência Artificial — Gemini (Google) com Groq como reserva.
 *
 * .env: GEMINI_API_KEY, GEMINI_MODELO (opcional), GROQ_API_KEY, GROQ_MODELO (opcional),
 *       IA_PRINCIPAL (opcional: "groq" para usar o Groq primeiro).
 * Basta uma das chaves. Com as duas, se a principal falhar (sobrecarga, limite,
 * erro), a outra responde. A IA apenas SUGERE; nada é gravado até alguém adotar.
 */

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
const GROQ_URL = "https://api.groq.com/openai/v1";
const PAUSAS_REPETICAO_MS = [2000, 5000];
// Passado este tempo, não tenta de novo nem troca de modelo: devolve o erro (ou passa para a reserva)
const LIMITE_TENTATIVAS_MS = 25000;

// Modelo escolhido sozinho quando o configurado deixa de existir (vale até a API reiniciar)
const modeloAtual = {
  gemini: process.env.GEMINI_MODELO || "gemini-2.5-flash",
  groq: process.env.GROQ_MODELO || "llama-3.3-70b-versatile"
};

type Chamada = { status: number; corpo: string };
type RespostaProvedor = { json?: any; modelo?: string; erro?: string };
export type RespostaIA = { json?: any; erro?: string; provedor?: string; modelo?: string; segundos?: number };

const sobrecarga = (codigo: number) => [500, 502, 503, 504].includes(codigo);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const detalheDoErro = (corpo: string) => {
  try { return String(JSON.parse(corpo).error.message || ""); } catch { return ""; }
};

async function requisitar(url: string, init: RequestInit): Promise<Chamada> {
  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
    return { status: resp.status, corpo: await resp.text() };
  } catch (error) {
    console.error("Falha de rede ao chamar a IA:", error);
    return { status: 504, corpo: "" };
  }
}

/* ---------- Gemini ---------- */

/** Os modelos 2.5+ "pensam" antes de responder: desliga (2.5 flash) ou reduz (Gemini 3), que aqui não precisa. */
function configPensamento(modelo: string) {
  if (/2\.5-flash/i.test(modelo)) return { thinkingBudget: 0 };
  if (/gemini-3/i.test(modelo)) return { thinkingLevel: "low" };
  return null;
}

async function gerarConteudo(chave: string, modelo: string, prompt: string, comPensamento = true): Promise<Chamada> {
  const config: Record<string, unknown> = { temperature: 0.6, responseMimeType: "application/json" };
  const pensamento = comPensamento ? configPensamento(modelo) : null;
  if (pensamento) config.thinkingConfig = pensamento;
  const r = await requisitar(`${GEMINI_URL}/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: config })
  });
  // Modelo que não aceita configurar o pensamento: repete sem a opção
  if (pensamento && r.status === 400 && /think/i.test(r.corpo)) return gerarConteudo(chave, modelo, prompt, false);
  return r;
}

/** Repete em caso de sobrecarga temporária, com pausas crescentes. */
async function gerarComRepeticao(chave: string, modelo: string, prompt: string, pausas: number[], inicio: number) {
  let r = await gerarConteudo(chave, modelo, prompt);
  for (let i = 0; i < pausas.length && sobrecarga(r.status); i++) {
    if (Date.now() - inicio + pausas[i] > LIMITE_TENTATIVAS_MS) break;
    await esperar(pausas[i]);
    r = await gerarConteudo(chave, modelo, prompt);
  }
  return r;
}

async function listarModelosGemini(chave: string): Promise<string[] | null> {
  const r = await requisitar(`${GEMINI_URL}/models?pageSize=200`, { headers: { "x-goog-api-key": chave } });
  if (r.status !== 200) return null;
  return (JSON.parse(r.corpo).models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m: any) => String(m.name).replace(/^models\//, ""));
}

const versao = (n: string) => parseFloat((n.match(/(\d+(?:\.\d+)?)/) || [])[1] || "0");

/** Melhor "flash" disponível: versão mais nova, evitando variantes especiais. aceitaLite = socorro na sobrecarga. */
async function escolherModeloGemini(chave: string, atual: string, aceitaLite: boolean) {
  const nomes = await listarModelosGemini(chave);
  if (!nomes) return null;
  const especial = aceitaLite
    ? /(preview|exp|thinking|image|tts|audio|live|vision|embedding|learnlm)/i
    : /(lite|preview|exp|thinking|image|tts|audio|live|vision|embedding|8b|learnlm)/i;
  const candidatos = nomes.filter((n) => /flash/i.test(n) && n !== atual);
  const estaveis = candidatos.filter((n) => !especial.test(n));
  const lista = (estaveis.length || aceitaLite ? estaveis : candidatos)
    .sort((a, b) => versao(b) - versao(a) || a.length - b.length);
  return lista[0] || null;
}

function mensagemErroGemini(codigo: number, corpo: string, modelo: string) {
  const detalhe = detalheDoErro(corpo);
  if (codigo === 429) return "Limite gratuito da IA atingido. Tente novamente em alguns minutos.";
  if (sobrecarga(codigo)) return "A IA do Google está sobrecarregada no momento (já tentamos de novo automaticamente). Aguarde 1 ou 2 minutos e clique outra vez.";
  if (codigo === 400 && /api key/i.test(detalhe)) return "A GEMINI_API_KEY é inválida. Gere uma nova chave no Google AI Studio e atualize o .env do servidor.";
  if (codigo === 403) return `A chave do Gemini não tem permissão (${detalhe || "acesso negado"}). Confira a chave e o projeto no Google AI Studio.`;
  if (codigo === 404) return `O modelo "${modelo}" não está disponível. Ajuste GEMINI_MODELO no .env do servidor.`;
  return `A IA retornou erro ${codigo}${detalhe ? ": " + detalhe : "."}`;
}

async function chamarGemini(prompt: string, rapido: boolean): Promise<RespostaProvedor> {
  const chave = process.env.GEMINI_API_KEY as string;
  let modelo = modeloAtual.gemini;
  const pausas = rapido ? PAUSAS_REPETICAO_MS.slice(0, 1) : PAUSAS_REPETICAO_MS;
  const inicio = Date.now();

  let r = await gerarComRepeticao(chave, modelo, prompt, pausas, inicio);

  // Modelo aposentado: escolhe um "flash" disponível, guarda e tenta de novo
  if (r.status === 404) {
    const alternativo = await escolherModeloGemini(chave, modelo, false);
    if (alternativo) {
      modeloAtual.gemini = modelo = alternativo;
      r = await gerarComRepeticao(chave, modelo, prompt, pausas, inicio);
    }
  }
  // Sobrecarga persistente: outro modelo flash só nesta chamada. No modo rápido, pula.
  if (sobrecarga(r.status) && !rapido && Date.now() - inicio < LIMITE_TENTATIVAS_MS) {
    const reserva = await escolherModeloGemini(chave, modelo, true);
    if (reserva) {
      const r2 = await gerarComRepeticao(chave, reserva, prompt, pausas, inicio);
      if (r2.status === 200) { r = r2; modelo = reserva; }
    }
  }
  if (r.status !== 200) return { erro: mensagemErroGemini(r.status, r.corpo, modelo) };

  try {
    const corpo = JSON.parse(r.corpo);
    const saida = corpo.candidates[0].content.parts.map((p: any) => p.text || "").join("");
    return { json: JSON.parse(saida), modelo };
  } catch {
    return { erro: "Não foi possível interpretar a resposta da IA." };
  }
}

/* ---------- Groq (API compatível com OpenAI) ---------- */

const conversarGroq = (chave: string, modelo: string, prompt: string) =>
  requisitar(`${GROQ_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
      temperature: 0.6,
      response_format: { type: "json_object" }, // o prompt precisa mencionar JSON (os nossos mencionam)
      messages: [{ role: "user", content: prompt }]
    })
  });

/** Prefere modelos grandes e de uso geral (70b/120b/"versatile"); exclui áudio, voz e moderação. */
async function escolherModeloGroq(chave: string, atual: string) {
  const r = await requisitar(`${GROQ_URL}/models`, { headers: { Authorization: `Bearer ${chave}` } });
  if (r.status !== 200) return null;
  const nota = (id: string) =>
    (/(120b|70b|versatile)/i.test(id) ? 10 : 0) + (/(llama|gpt-oss|qwen|kimi|deepseek)/i.test(id) ? 2 : 0) -
    (/(instant|8b|mini|preview)/i.test(id) ? 5 : 0);
  return (JSON.parse(r.corpo).data || [])
    .filter((m: any) => m.active !== false)
    .map((m: any) => String(m.id))
    .filter((id: string) => id !== atual && !/(whisper|tts|guard|playai|orpheus|distil|embed|vision|speech|audio)/i.test(id))
    .sort((a: string, b: string) => nota(b) - nota(a) || a.length - b.length)[0] || null;
}

function mensagemErroGroq(codigo: number, corpo: string, modelo: string) {
  const detalhe = detalheDoErro(corpo);
  if (codigo === 401) return "A GROQ_API_KEY é inválida. Gere uma nova chave em console.groq.com/keys e atualize o .env do servidor.";
  if (codigo === 429) return "Limite gratuito do Groq atingido. Tente novamente em alguns minutos.";
  if (sobrecarga(codigo)) return "O Groq está sobrecarregado no momento. Tente novamente em instantes.";
  if (codigo === 404) return `O modelo "${modelo}" não está disponível no Groq. Ajuste GROQ_MODELO no .env do servidor.`;
  return `O Groq retornou erro ${codigo}${detalhe ? ": " + detalhe : "."}`;
}

async function chamarGroq(prompt: string): Promise<RespostaProvedor> {
  const chave = process.env.GROQ_API_KEY as string;
  let modelo = modeloAtual.groq;
  let r = await conversarGroq(chave, modelo, prompt);

  // Modelo desativado: escolhe outro de texto disponível e guarda
  if (r.status === 404 || (r.status === 400 && /decommission|not found|does not exist|model_not_found/i.test(r.corpo))) {
    const alternativo = await escolherModeloGroq(chave, modelo);
    if (alternativo) {
      modeloAtual.groq = modelo = alternativo;
      r = await conversarGroq(chave, modelo, prompt);
    }
  }
  if (sobrecarga(r.status)) {
    await esperar(PAUSAS_REPETICAO_MS[0]);
    r = await conversarGroq(chave, modelo, prompt);
  }
  if (r.status !== 200) return { erro: mensagemErroGroq(r.status, r.corpo, modelo) };

  try {
    return { json: JSON.parse(JSON.parse(r.corpo).choices[0].message.content), modelo };
  } catch {
    return { erro: "Não foi possível interpretar a resposta do Groq." };
  }
}

/** Chama a IA principal e, se ela falhar, a reserva. */
export async function chamarIA(prompt: string): Promise<RespostaIA> {
  const disponiveis: ("gemini" | "groq")[] = [];
  if (process.env.GEMINI_API_KEY) disponiveis.push("gemini");
  if (process.env.GROQ_API_KEY) disponiveis.push("groq");
  if (!disponiveis.length) return { erro: "IA não configurada: cadastre GEMINI_API_KEY ou GROQ_API_KEY no .env do servidor." };
  if (String(process.env.IA_PRINCIPAL || "").toLowerCase() === "groq") disponiveis.reverse();

  const temReserva = disponiveis.length > 1;
  const erros: string[] = [];
  const inicio = Date.now();
  for (const provedor of disponiveis) {
    const nome = provedor === "gemini" ? "Gemini" : "Groq";
    const t0 = Date.now();
    // Com reserva disponível, a principal desiste mais rápido (menos espera na tela)
    const r = provedor === "gemini" ? await chamarGemini(prompt, temReserva) : await chamarGroq(prompt);
    console.log(`IA ${nome}${r.modelo ? ` (${r.modelo})` : ""}: ${r.json ? "ok" : "falhou"} em ${((Date.now() - t0) / 1000).toFixed(1)} s${r.erro ? " — " + r.erro : ""}`);
    if (r.json) return { json: r.json, provedor: nome, modelo: r.modelo || "", segundos: Math.round((Date.now() - inicio) / 1000) };
    erros.push(`${nome}: ${r.erro}`);
  }
  return { erro: erros.join(" | ") };
}
