/* ==========================================================
   Sistema de Apoio a Reuniões — frontend
   Backend: Google Apps Script + Google Planilhas (Code.gs)
   ========================================================== */

// ⬇️ URL da implantação do Apps Script (Implantar → Gerenciar implantações) ⬇️
const API_URL = "https://script.google.com/macros/s/AKfycbxpKYxg6B0rjoS6nAbi5PL2eVrzok4EoDDyVczepN9JsgmhsvuEFZLU9YgjL11H8qQT/exec";

// Abra index.html?demo para testar a interface sem a planilha (dados em memória)
const MODO_DEMO = new URLSearchParams(location.search).has("demo");
const CHAVE_TOKEN = MODO_DEMO ? "sre_token_demo" : "sre_token";

const estado = {
  token: "",
  usuario: null,         // { nome, apelido, nivel } de quem está logado
  nivel: "",
  detalhes: {},          // conteúdo de cada pauta já aberta: { ideia, interacoes, encaminhamentos }
  ultimaResposta: null,  // último resumo recebido (guardado para abrir rápido ao recarregar)
  grupo: null,           // ID do GT aberto; null = tela com a lista de GTs
  dados: { ideias: [], interacoes: [], encaminhamentos: [], usuarios: [], citacoes: [], recomendacoes: [] },
  listas: {
    STATUS_IDEIA: ["Em Debate", "Em Redação", "Aprovada", "Arquivada"],
    TIPOS_INTERACAO: ["Comentário", "Sugestão"],
    STATUS_ENCAMINHAMENTO: ["Pendente", "Em Andamento", "Concluído", "Cancelado"],
    STATUS_CITACAO: ["Pendente", "Encaminhada", "Resolvida"]
  },
  selecionada: null,
  aba: "discussao",
  filtroTipo: "",
  filtroCitacoes: "Pendente",
  citacaoOrigem: null,   // citação que deu origem ao encaminhamento em edição
  iaEncaminhamentos: {}, // sugestões da IA por pauta, mantidas entre recargas
  sugestoesAbertas: new Set() // sugestões expandidas no acordeom (sobrevive ao redesenho)
};

const $ = (sel, raiz = document) => raiz.querySelector(sel);

/* ---------- Grupos de trabalho (GTs) ---------- */

// Pautas sem grupo (de antes dos GTs) pertencem ao GT-Sistemas, como no Code.gs
const GRUPO_PADRAO = { ID_Grupo: "GT-SISTEMAS", Nome: "GT-Sistemas", Descricao: "", Ativo: "Sim" };
const CHAVE_GRUPO = MODO_DEMO ? "sre_grupo_demo" : "sre_grupo";
const grupoDe = i => String(i.ID_Grupo || "") || GRUPO_PADRAO.ID_Grupo;
const grupoAtivo = g => g.Ativo === true || /^(sim|true)$/i.test(String(g.Ativo));
const grupoAtual = () => (estado.dados.grupos || []).find(g => String(g.ID_Grupo) === String(estado.grupo)) || null;
const ideiasDoGrupo = () => estado.dados.ideias.filter(i => grupoDe(i) === estado.grupo);

function definirGrupo(id) {
  estado.grupo = id ? String(id) : null;
  try {
    if (estado.grupo) sessionStorage.setItem(CHAVE_GRUPO, estado.grupo);
    else sessionStorage.removeItem(CHAVE_GRUPO);
  } catch (e) {}
}

try { estado.grupo = sessionStorage.getItem(CHAVE_GRUPO) || null; } catch (e) {}

/* ---------------------------------------------------------- */
/* Comunicação com a API                                       */
/* ---------------------------------------------------------- */

let cargas = 0;
let timerLoading = null;

// Primeira mensagem do loading: o que está acontecendo de fato
const LOADING_ACAO = {
  LOGIN: "Conferindo usuário e senha...",
  LISTAR: "Buscando as pautas na planilha...",
  CRIAR_IDEIA: "Salvando a pauta...",
  EDITAR_IDEIA: "Salvando as alterações da pauta...",
  ADD_INTERACAO: "Registrando na planilha...",
  ADD_ENCAMINHAMENTO: "Registrando o encaminhamento...",
  ATUALIZAR_ENCAMINHAMENTO: "Atualizando o encaminhamento...",
  ATUALIZAR_CITACAO: "Atualizando a citação...",
  CRIAR_USUARIO: "Cadastrando o usuário...",
  EDITAR_USUARIO: "Atualizando o usuário...",
  ALTERAR_SENHA: "Alterando a sua senha...",
  EXCLUIR_INTERACAO: "Conferindo a senha e excluindo...",
  EXCLUIR_RECOMENDACAO: "Conferindo a senha e excluindo...",
  CRIAR_GRUPO: "Criando o grupo de trabalho...",
  EDITAR_GRUPO: "Atualizando o grupo de trabalho...",
  CRIAR_RECOMENDACAO: "Salvando o metadado...",
  EDITAR_RECOMENDACAO: "Salvando o metadado...",
  IA_SUGERIR_PAUTAS: "Enviando as pautas do GT para a IA...",
  IA_SUGERIR_ENCAMINHAMENTOS: "Enviando a pauta e os comentários para a IA...",
  RELATORIO_GT: "Preparando o relatório do GT..."
};
// Mensagens que vão se revezando enquanto a resposta não chega
const LOADING_SEGUINTES = {
  IA: ["A IA está lendo a discussão...", "Analisando sugestões e comentários...", "Montando a síntese...", "Escrevendo as sugestões...", "A IA às vezes leva até um minuto. Só mais um momento..."],
  PADRAO: ["Falando com a planilha do Google...", "Estamos trabalhando nisso...", "Quase lá...", "Só mais um momento...", "A planilha está demorando um pouco mais que o normal, mas segue trabalhando..."]
};
const LOADING_INTERVALO = 3500;
let loadingRelogio = null;
let loadingProgresso = null; // texto de progresso real; enquanto houver, não reveza mensagens

function definirProgressoLoading(texto) {
  loadingProgresso = texto;
  if (texto && $("#loadingMsg").textContent !== texto) $("#loadingMsg").textContent = texto;
}

function trocarMensagemLoading(texto) {
  const el = $("#loadingMsg");
  el.textContent = texto;
  el.style.animation = "none";
  void el.offsetWidth; // reinicia a animação de entrada
  el.style.animation = "";
}

function iniciarMensagensLoading(acao) {
  clearInterval(loadingRelogio);
  const seguintes = /^IA_/.test(acao) ? LOADING_SEGUINTES.IA : LOADING_SEGUINTES.PADRAO;
  const inicio = Date.now();
  let passo = -1;
  trocarMensagemLoading(LOADING_ACAO[acao] || "Aguarde...");
  $("#loadingTempo").textContent = "";
  loadingRelogio = setInterval(() => {
    const seg = Math.round((Date.now() - inicio) / 1000);
    // A última mensagem fica fixa; antes dela, uma nova a cada LOADING_INTERVALO
    const novoPasso = Math.min(Math.floor((Date.now() - inicio) / LOADING_INTERVALO) - 1, seguintes.length - 1);
    if (!loadingProgresso && novoPasso > passo) { passo = novoPasso; trocarMensagemLoading(seguintes[passo]); }
    $("#loadingTempo").textContent = seg >= 5 ? `${seg} s` : "";
  }, 500);
}

function mostrarLoading(acao = "") {
  cargas++;
  clearTimeout(timerLoading);
  const el = $("#loading");
  // Dentro de um <dialog> aberto o loading precisa estar no mesmo "top layer"
  (document.querySelector("dialog[open]") || document.body).appendChild(el);
  if (el.hidden || acao) iniciarMensagensLoading(acao);
  el.hidden = false;
}

function esconderLoading() {
  cargas = Math.max(0, cargas - 1);
  if (cargas === 0) timerLoading = setTimeout(() => { $("#loading").hidden = true; clearInterval(loadingRelogio); }, 120);
}

let sincronizando = 0;
function marcarSincronizando(delta) {
  sincronizando = Math.max(0, sincronizando + delta);
  const el = $("#sincronizando");
  if (el) el.hidden = sincronizando === 0;
}

/** silencioso: não cobre a tela com o "Aguarde..." (só um indicador discreto no topo). */
async function api(acao, dados = {}, { silencioso = false } = {}) {
  const req = { ...dados, acao, token: estado.token };
  if (silencioso) marcarSincronizando(1); else mostrarLoading(acao);
  try {
    if (MODO_DEMO) return await demoApi(req);
    // text/plain evita o preflight CORS, que o Apps Script não atende
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(req)
    });
    const corpo = await res.text();
    let json;
    try { json = JSON.parse(corpo); } catch (e) { json = null; }
    // Resposta vazia/HTML ou mensagem do script antigo = Code.gs novo não implantado
    if (!json || json.message === "Senha de escrita incorreta!" || (acao === "LOGIN" && json.status === "success" && !json.token)) {
      return { status: "error", message: "A planilha respondeu, mas ainda está com o código antigo. No Apps Script, cole o Code.gs novo e publique uma Nova versão em Implantar → Gerenciar implantações." };
    }
    return json;
  } catch (err) {
    console.error(err);
    return { status: "error", message: "Falha de conexão com a planilha. Verifique a URL e a implantação do Apps Script." };
  } finally {
    if (silencioso) marcarSincronizando(-1); else esconderLoading();
  }
}

/** Sessão expirada/derrubada: volta para a tela de login. */
function sessaoExpirou(r) {
  if (r.codigo !== "SESSAO") return false;
  encerrarSessaoLocal();
  mostrarLogin(r.message);
  return true;
}

/**
 * Executa uma ação de escrita e avisa o usuário. O servidor já devolve o resumo
 * e o detalhe da pauta atualizados, então não há segunda requisição.
 */
async function gravar(acao, dados) {
  const r = await api(acao, dados);
  if (sessaoExpirou(r)) return false;
  if (r.status !== "success") {
    aviso(r.message || "Não foi possível salvar.", true);
    return false;
  }
  aviso(r.message || "Salvo!");
  if (r.dados) {
    aplicarResposta(r);
    configurarPerfil();
    renderizarTudo();
  } else {
    await carregar(); // Code.gs antigo, que não devolve os dados
  }
  return r;
}

/* ---------------------------------------------------------- */
/* Carga parcial: detalhe de cada pauta sob demanda            */
/* ---------------------------------------------------------- */

const detalheDe = id => estado.detalhes[String(id)] || null;

/** Pauta do resumo, com a descrição completa quando o detalhe já foi carregado. */
function ideiaCompleta(id) {
  const resumo = estado.dados.ideias.find(i => String(i.ID_Ideia) === String(id));
  const det = detalheDe(id);
  if (!resumo) return null;
  return det && det.ideia ? { ...resumo, ...det.ideia } : resumo;
}

const carregandoDetalhe = {};

/** Busca o detalhe da pauta no servidor (sem cobrir a tela) e redesenha se ela ainda estiver aberta. */
async function carregarDetalhe(id) {
  id = String(id);
  if (carregandoDetalhe[id]) return carregandoDetalhe[id];
  carregandoDetalhe[id] = (async () => {
    const r = await api("DETALHE_IDEIA", { idIdeia: id }, { silencioso: true });
    delete carregandoDetalhe[id];
    if (sessaoExpirou(r)) return null;
    if (r.status !== "success") {
      // Code.gs antigo: sem DETALHE_IDEIA, os dados completos vêm no LISTAR
      if (/Ação desconhecida/.test(r.message || "")) return null;
      aviso(r.message, true);
      return null;
    }
    estado.detalhes[id] = r.detalhe;
    salvarCopiaLocal();
    if (String(estado.selecionada) === id) renderizarDetalhe();
    renderizarLista();
    return r.detalhe;
  })();
  return carregandoDetalhe[id];
}

/** Abre a pauta: mostra o que já tem na hora e atualiza em segundo plano. */
function selecionarPauta(id) {
  estado.selecionada = String(id);
  renderizarLista();
  renderizarDetalhe();
  return carregarDetalhe(id);
}

/* ---------------------------------------------------------- */
/* Login / sessão                                              */
/* ---------------------------------------------------------- */

async function entrar(usuario, senha) {
  const r = await api("LOGIN", { usuario, senha });
  if (r.status !== "success") return r.message || "Usuário ou senha inválidos.";
  estado.token = r.token;
  try { sessionStorage.setItem(CHAVE_TOKEN, r.token); } catch (e) {}
  // O login já traz os dados iniciais (Code.gs novo); se não trouxer, busca
  return await abrirApp(r.dados ? r : null);
}

/** Mostra o painel com a resposta recebida (ou busca no servidor). Retorna mensagem de erro ou null. */
async function abrirApp(resposta, silencioso = false) {
  const r = resposta || await api("LISTAR", {}, { silencioso });
  if (sessaoExpirou(r)) return r.message;
  if (r.status !== "success") {
    if (!silencioso) encerrarSessaoLocal();
    return r.message || "Não foi possível carregar os dados.";
  }
  const primeiraVez = $("#telaApp").hidden;
  aplicarResposta(r);
  $("#telaLogin").hidden = true;
  $("#telaApp").hidden = false;
  configurarPerfil();
  renderizarTudo();
  if (primeiraVez) {
    const pend = minhasCitacoes().filter(c => c.Status === "Pendente").length;
    if (pend) aviso(`Você tem ${pend} citação(ões) pendente(s). Clique no sino para ver.`);
  }
  return null;
}

function encerrarSessaoLocal() {
  senhaIA = "";
  estado.token = "";
  estado.usuario = null;
  estado.detalhes = {};
  definirGrupo(null);
  try {
    sessionStorage.removeItem(CHAVE_TOKEN);
    sessionStorage.removeItem(CHAVE_COPIA);
  } catch (e) {}
}

/* ---------- Cópia local (abre na hora ao recarregar a página) ---------- */

const CHAVE_COPIA = MODO_DEMO ? "sre_copia_demo" : "sre_copia";
const MAX_DETALHES_GUARDADOS = 15;

function salvarCopiaLocal() {
  if (!estado.token || !estado.ultimaResposta) return;
  const ids = Object.keys(estado.detalhes).slice(-MAX_DETALHES_GUARDADOS);
  const detalhes = {};
  ids.forEach(id => { detalhes[id] = estado.detalhes[id]; });
  try {
    sessionStorage.setItem(CHAVE_COPIA, JSON.stringify({ token: estado.token, resposta: estado.ultimaResposta, detalhes }));
  } catch (e) { /* cota cheia ou bloqueada: segue sem cópia */ }
}

function lerCopiaLocal(token) {
  try {
    const c = JSON.parse(sessionStorage.getItem(CHAVE_COPIA) || "null");
    return c && c.token === token ? c : null;
  } catch (e) { return null; }
}

function mostrarLogin(msg) {
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  $("#telaApp").hidden = true;
  $("#telaLogin").hidden = false;
  $("#senhaInput").value = "";
  $("#erroLogin").hidden = !msg;
  $("#erroLogin").textContent = msg || "";
}

async function sair() {
  if (estado.token) await api("SAIR");
  encerrarSessaoLocal();
  location.reload();
}

/** Recarrega o resumo e, se houver pauta aberta, o detalhe dela. */
async function carregar(silencioso = false) {
  const pedidos = [api("LISTAR", {}, { silencioso })];
  if (estado.selecionada) pedidos.push(carregarDetalhe(estado.selecionada));
  const [r] = await Promise.all(pedidos);
  if (sessaoExpirou(r)) return;
  if (r.status !== "success") return aviso(r.message, true);
  aplicarResposta(r);
  configurarPerfil();
  renderizarTudo();
}

/** Aplica uma resposta do servidor (resumo e, se vier, o detalhe de uma pauta). */
function aplicarResposta(r) {
  if (r.dados) {
    estado.nivel = r.nivelAcesso;
    estado.usuario = r.usuario || null;
    estado.dados = { ideias: [], usuarios: [], citacoes: [], recomendacoes: [], ...r.dados };
    // Code.gs sem GTs: todas as pautas ficam no GT-Sistemas
    if (!Array.isArray(r.dados.grupos) || !r.dados.grupos.length) estado.dados.grupos = [{ ...GRUPO_PADRAO }];
    if (r.listas) estado.listas = { ...estado.listas, ...r.listas };
    estado.ultimaResposta = { nivelAcesso: r.nivelAcesso, usuario: r.usuario, dados: r.dados, listas: r.listas, hoje: r.hoje };
    // Code.gs antigo manda tudo de uma vez: monta os detalhes a partir disso
    if (Array.isArray(r.dados.interacoes)) montarDetalhesLegados(r.dados);
  }
  if (r.detalhe) estado.detalhes[String(r.detalhe.idIdeia)] = r.detalhe;
  salvarCopiaLocal();
}

function montarDetalhesLegados(d) {
  d.ideias.forEach(i => {
    const id = String(i.ID_Ideia);
    const ints = d.interacoes.filter(x => String(x.ID_Ideia) === id);
    const encs = (d.encaminhamentos || []).filter(x => String(x.ID_Ideia) === id);
    estado.detalhes[id] = { idIdeia: id, ideia: i, interacoes: ints, encaminhamentos: encs };
    i.Qtd_Sugestoes = ints.filter(x => x.Tipo === "Sugestão" && !x.ID_Pai).length;
    i.Qtd_Comentarios = ints.length - i.Qtd_Sugestoes;
    i.Qtd_Encaminhamentos = encs.length;
    i.Qtd_Abertos = encs.filter(emAberto).length;
    i.Qtd_Atrasados = encs.filter(atrasado).length;
    i.Descricao_Completa = true;
  });
}

const ehAdmin = () => estado.nivel === "ADMIN";
const podeEscrever = () => estado.nivel === "ESCRITA" || ehAdmin();
// Curtir e comentar sugestões: qualquer usuário com login próprio (inclusive Leitura)
const podeInteragir = () => !!(estado.usuario && estado.usuario.apelido);
// Quem pode excluir sugestões e comentários é decidido no servidor (Code.gs)
const podeExcluirInteracoes = () => !!(estado.usuario && estado.usuario.podeExcluirInteracoes);

/** Pede a senha de quem está logado antes de excluir. Devolve a senha, ou null se cancelar. */
function pedirSenhaExclusao(mensagem) {
  return pedirSenha({ titulo: "Confirmar exclusão", mensagem, rotulo: "Digite a sua senha para confirmar", botao: "Excluir", perigo: true });
}

/** Janela de senha reaproveitada (exclusão e IA). Devolve a senha digitada, ou null se cancelar. */
function pedirSenha({ titulo, mensagem, rotulo, botao, perigo = false }) {
  const modal = $("#modalExcluir");
  $("#senhaTitulo").textContent = titulo;
  $("#excluirMsg").textContent = mensagem;
  $("#excluirMsg").hidden = !mensagem;
  $("#senhaRotulo").textContent = rotulo;
  $("#btnConfirmarSenha").textContent = botao;
  $("#btnConfirmarSenha").className = "btn " + (perigo ? "btn-perigo" : "btn-primario");
  $("#excluirSenha").autocomplete = perigo ? "current-password" : "off";
  $("#formExcluir").reset();
  modal.showModal();
  $("#excluirSenha").focus();
  return new Promise(resolve => {
    const fim = valor => {
      $("#formExcluir").onsubmit = null;
      $("#btnCancelarExcluir").onclick = null;
      modal.onclose = null;
      if (modal.open) modal.close();
      resolve(valor);
    };
    $("#formExcluir").onsubmit = ev => { ev.preventDefault(); fim($("#excluirSenha").value); };
    $("#btnCancelarExcluir").onclick = () => fim(null);
    modal.onclose = () => fim(null); // Esc
  });
}

const ROTULO_NIVEL = {
  ADMIN: ["Administrador", "selo-admin"],
  ESCRITA: ["Colaborador", "selo-escrita"],
  LEITURA: ["Somente leitura", "selo-leitura"]
};

function configurarPerfil() {
  const [rotulo, classe] = ROTULO_NIVEL[estado.nivel] || ROTULO_NIVEL.LEITURA;
  const selo = $("#seloPerfil");
  selo.textContent = rotulo;
  selo.className = "selo " + classe;
  $("#nomeLogado").textContent = estado.usuario ? estado.usuario.nome : "";
  const contaPropria = !!(estado.usuario && estado.usuario.apelido && estado.usuario.apelido !== "admin");
  $("#btnSenha").hidden = !contaPropria;
  $("#btnCitacoes").hidden = !contaPropria;
  document.querySelectorAll(".somente-escrita").forEach(el => { el.hidden = !podeEscrever(); });
  document.querySelectorAll(".somente-admin").forEach(el => { el.hidden = !ehAdmin(); });

  const filtro = $("#filtroStatus");
  filtro.innerHTML = '<option value="">Todos os status</option>' +
    estado.listas.STATUS_IDEIA.map(s => `<option>${esc(s)}</option>`).join("");
  $("#pStatus").innerHTML = estado.listas.STATUS_IDEIA.map(s => `<option>${esc(s)}</option>`).join("");
}

/* ---------------------------------------------------------- */
/* Utilitários                                                 */
/* ---------------------------------------------------------- */

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtData(v, comHora = false) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [a, m, d] = s.split("-");
    return `${d}/${m}/${a}`;
  }
  const dt = new Date(s);
  if (isNaN(dt)) return s;
  return comHora
    ? dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : dt.toLocaleDateString("pt-BR");
}

function prazoISO(v) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  return isNaN(dt) ? "" : dt.toISOString().slice(0, 10);
}

function hojeISO(somaDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + somaDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const emAberto = e => e.Status === "Pendente" || e.Status === "Em Andamento";
const atrasado = e => emAberto(e) && prazoISO(e.Prazo) && prazoISO(e.Prazo) < hojeISO();

const CLASSE_STATUS = {
  "Em Debate": "st-debate", "Em Redação": "st-redacao", "Aprovada": "st-aprovada", "Arquivada": "st-arquivada",
  "Pendente": "st-pendente", "Em Andamento": "st-andamento", "Concluído": "st-concluido", "Cancelado": "st-cancelado"
};
const seloStatus = s => `<span class="selo ${CLASSE_STATUS[s] || ""}">${esc(s)}</span>`;

const doIdeia = (lista, id) => lista.filter(x => String(x.ID_Ideia) === String(id));

/* ---------- Usuários e citações ---------- */

const usuarioAtivo = u => u.Ativo === true || /^(sim|true)$/i.test(String(u.Ativo));
const usuariosAtivos = () => estado.dados.usuarios.filter(usuarioAtivo)
  .sort((a, b) => String(a.Nome).localeCompare(String(b.Nome), "pt-BR"));
const porApelido = ap => estado.dados.usuarios.find(u => String(u.Apelido).toLowerCase() === String(ap).toLowerCase());

/** Cadastro de quem está logado (null para admin e observador). */
function meuUsuario() {
  const ap = estado.usuario && estado.usuario.apelido;
  if (!ap || ap === "admin") return null;
  return porApelido(ap) || null;
}

const minhasCitacoes = () => {
  const eu = meuUsuario();
  if (!eu) return [];
  return estado.dados.citacoes
    .filter(c => String(c.Apelido).toLowerCase() === String(eu.Apelido).toLowerCase())
    .sort((a, b) => String(b.Data).localeCompare(String(a.Data)));
};

/** Escapa o texto e destaca @apelidos de usuários cadastrados. */
function formatarTexto(t) {
  const eu = meuUsuario();
  return esc(t).replace(/@([a-z0-9._-]+)/gi, (trecho, ap) => {
    const limpo = ap.replace(/[.\-_]+$/, "");
    const u = porApelido(limpo);
    if (!u) return trecho;
    const resto = ap.slice(limpo.length);
    const souEu = eu && u.Apelido === eu.Apelido;
    return `<span class="mencao ${souEu ? "eu-citado" : ""}" title="${esc(u.Nome)}">@${esc(limpo)}</span>${resto}`;
  });
}

const citaEu = t => {
  const eu = meuUsuario();
  return !!eu && new RegExp(`@${eu.Apelido.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_-])`, "i").test(String(t));
};

/** Converte o link do Google Docs em endereço de pré-visualização embutível. */
function linkPreview(link) {
  const m = String(link).match(/^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
  return m ? `https://docs.google.com/${m[1]}/d/${m[2]}/preview` : "";
}

let timerAviso = null;
function aviso(msg, ehErro = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (ehErro ? " erro" : "");
  t.hidden = false;
  (document.querySelector("dialog[open]") || document.body).appendChild(t);
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ---------------------------------------------------------- */
/* Renderização                                                */
/* ---------------------------------------------------------- */

function renderizarTudo() {
  renderizarTopo();
  // GT aberto que sumiu (desativado para quem não é admin): volta à lista
  if (estado.grupo && !grupoAtual()) definirGrupo(null);
  $("#telaGrupos").hidden = !!estado.grupo;
  $("#telaPainel").hidden = !estado.grupo;
  if (!estado.grupo) return renderizarGrupos();
  const g = grupoAtual();
  $("#nomeGrupo").textContent = g.Nome;
  $("#descGrupo").textContent = g.Descricao || "";
  renderizarKpis();
  renderizarLista();
  renderizarDetalhe();
}

/* ---------- Tela com a lista de GTs ---------- */

function renderizarGrupos() {
  const grupos = [...(estado.dados.grupos || [])]
    .sort((a, b) => (grupoAtivo(b) - grupoAtivo(a)) || String(a.Nome).localeCompare(String(b.Nome), "pt-BR"));
  $("#listaGrupos").innerHTML = grupos.length ? grupos.map(g => {
    const ideias = estado.dados.ideias.filter(i => grupoDe(i) === String(g.ID_Grupo));
    const soma = campo => ideias.reduce((t, i) => t + (Number(i[campo]) || 0), 0);
    const ativas = ideias.filter(i => i.Status !== "Arquivada").length;
    const debate = ideias.filter(i => i.Status === "Em Debate").length;
    const atrasados = soma("Qtd_Atrasados");
    return `
      <button class="grupo-card ${grupoAtivo(g) ? "" : "inativo"}" data-grupo="${esc(g.ID_Grupo)}">
        <h3><span>${esc(g.Nome)}</span>${grupoAtivo(g) ? "" : '<span class="selo st-arquivada">Desativado</span>'}</h3>
        <p>${esc(g.Descricao) || "Sem descrição."}</p>
        <div class="grupo-numeros">
          <div><strong>${ativas}</strong><span>pautas ativas</span></div>
          <div><strong>${debate}</strong><span>em debate</span></div>
          <div><strong>${soma("Qtd_Abertos")}</strong><span>ações em aberto</span></div>
          <div class="${atrasados ? "perigo" : ""}"><strong>${atrasados}</strong><span>atrasadas</span></div>
        </div>
      </button>`;
  }).join("") : `<div class="vazio">Nenhum grupo de trabalho cadastrado.</div>`;
}

function abrirGrupo(id) {
  if (String(id) !== String(estado.grupo)) {
    estado.selecionada = null;
    estado.citacaoOrigem = null;
    $("#busca").value = "";
    $("#filtroStatus").value = "";
  }
  definirGrupo(id);
  renderizarTudo();
}

function voltarAosGrupos() {
  definirGrupo(null);
  estado.selecionada = null;
  renderizarTudo();
  window.scrollTo(0, 0);
}

let editandoGrupo = null;

function abrirModalGrupo(grupo = null) {
  editandoGrupo = grupo;
  $("#modalGrupoTitulo").textContent = grupo ? "Editar grupo de trabalho" : "Novo grupo de trabalho";
  $("#gNome").value = grupo ? grupo.Nome : "";
  $("#gDescricao").value = grupo ? grupo.Descricao || "" : "";
  $("#btnAtivarGrupo").hidden = !grupo;
  if (grupo) $("#btnAtivarGrupo").textContent = grupoAtivo(grupo) ? "Desativar GT" : "Reativar GT";
  $("#erroGrupo").hidden = true;
  $("#modalGrupo").showModal();
  $("#gNome").focus();
}

async function salvarGrupo(ev) {
  ev.preventDefault();
  const dados = { nome: $("#gNome").value, descricao: $("#gDescricao").value };
  const r = editandoGrupo
    ? await gravar("EDITAR_GRUPO", { ...dados, idGrupo: editandoGrupo.ID_Grupo })
    : await gravar("CRIAR_GRUPO", dados);
  if (!r) return;
  $("#modalGrupo").close();
  if (!editandoGrupo && r.idGrupo) abrirGrupo(r.idGrupo);
}

async function alternarGrupoAtivo() {
  const g = editandoGrupo;
  if (!g) return;
  const desativar = grupoAtivo(g);
  if (desativar && !confirm(`Desativar o ${g.Nome}?\n\nEle deixa de aparecer para os usuários (as pautas ficam guardadas). Você pode reativá-lo depois.`)) return;
  const r = await gravar("EDITAR_GRUPO", { idGrupo: g.ID_Grupo, ativo: !desativar });
  if (r) $("#modalGrupo").close();
}

function renderizarTopo() {
  const ativos = usuariosAtivos();
  const pendentes = minhasCitacoes().filter(c => c.Status === "Pendente").length;
  const badge = $("#badgeCitacoes");
  badge.textContent = pendentes;
  badge.hidden = !pendentes;

  // Sugestões de nomes para os campos "Responsável"
  let dl = $("#dlUsuarios");
  if (!dl) { dl = document.createElement("datalist"); dl.id = "dlUsuarios"; document.body.appendChild(dl); }
  dl.innerHTML = ativos.map(u => `<option value="${esc(u.Nome)}">`).join("");

  if ($("#modalCitacoes").open) renderizarCitacoes();
  if ($("#modalUsuarios").open) renderizarUsuarios();
  if ($("#modalRecomendacoes").open) renderizarRecomendacoes();
}

function renderizarKpis() {
  const ideias = ideiasDoGrupo();
  const soma = campo => ideias.reduce((t, i) => t + (Number(i[campo]) || 0), 0);
  const ativas = ideias.filter(i => i.Status !== "Arquivada").length;
  const debate = ideias.filter(i => i.Status === "Em Debate").length;
  const abertos = soma("Qtd_Abertos");
  const atrasados = soma("Qtd_Atrasados");
  $("#kpis").innerHTML = `
    <div class="kpi"><span>Pautas ativas</span><strong>${ativas}</strong></div>
    <div class="kpi"><span>Em debate</span><strong>${debate}</strong></div>
    <div class="kpi"><span>Encaminhamentos em aberto</span><strong>${abertos}</strong></div>
    <div class="kpi ${atrasados ? "kpi-perigo" : ""}"><span>Encaminhamentos atrasados</span><strong>${atrasados}</strong></div>`;
}

function ideiasFiltradas() {
  const termo = $("#busca").value.trim().toLowerCase();
  const status = $("#filtroStatus").value;
  return ideiasDoGrupo()
    .filter(i => !status || i.Status === status)
    .filter(i => !termo || `${i.Titulo} ${i.Descricao}`.toLowerCase().includes(termo))
    .sort((a, b) => String(b.Data_Criacao).localeCompare(String(a.Data_Criacao)));
}

function renderizarLista() {
  const lista = ideiasFiltradas();
  const cont = $("#listaPautas");
  if (!lista.length) {
    cont.innerHTML = `<div class="vazio">${ideiasDoGrupo().length ? "Nenhuma pauta encontrada com esse filtro." : "Nenhuma pauta cadastrada neste GT ainda."}</div>`;
    return;
  }
  cont.innerHTML = lista.map(i => {
    const nInt = (Number(i.Qtd_Sugestoes) || 0) + (Number(i.Qtd_Comentarios) || 0);
    const nEncs = Number(i.Qtd_Encaminhamentos) || 0;
    const nAtrasados = Number(i.Qtd_Atrasados) || 0;
    return `
      <button class="pauta ${String(i.ID_Ideia) === String(estado.selecionada) ? "ativa" : ""}" data-id="${esc(i.ID_Ideia)}">
        <div class="pauta-topo"><h3>${esc(i.Titulo)}</h3>${seloStatus(i.Status)}</div>
        <p>${esc(i.Descricao) || "<em>Sem descrição</em>"}</p>
        <div class="pauta-meta">
          <span>💬 ${nInt}</span>
          <span>📌 ${nEncs}${nAtrasados ? ` <b class="prazo-atrasado">(${nAtrasados} atrasado${nAtrasados > 1 ? "s" : ""})</b>` : ""}</span>
          ${i.Link_Doc_Oficial ? "<span>📄 Texto oficial</span>" : ""}
          <span>${fmtData(i.Data_Criacao)}</span>
        </div>
      </button>`;
  }).join("");
}

function renderizarDetalhe() {
  const det = $("#detalhe");
  const ideia = ideiaCompleta(estado.selecionada);
  if (!ideia) {
    det.innerHTML = `<div class="vazio"><p>Selecione uma pauta para ver a discussão, os encaminhamentos e o texto oficial.</p></div>`;
    return;
  }
  const carregado = detalheDe(ideia.ID_Ideia);
  const interacoes = carregado ? carregado.interacoes : [];
  const encs = carregado ? carregado.encaminhamentos : [];
  const nSugestoes = carregado ? interacoes.filter(i => i.Tipo === "Sugestão" && !i.ID_Pai).length : (Number(ideia.Qtd_Sugestoes) || 0);
  const nEncs = carregado ? encs.length : (Number(ideia.Qtd_Encaminhamentos) || 0);

  const acoes = podeEscrever() ? `
    <div class="acoes-pauta">
      <select id="statusPauta" aria-label="Status da pauta">
        ${estado.listas.STATUS_IDEIA.map(s => `<option ${s === ideia.Status ? "selected" : ""}>${esc(s)}</option>`).join("")}
      </select>
      <button class="btn btn-secundario btn-pequeno" id="btnEditarPauta">Editar</button>
      <button class="btn btn-secundario btn-pequeno" id="btnRelatorio" title="Sugestões, comentários e encaminhamentos da pauta, prontos para imprimir ou salvar em PDF">Relatório</button>
    </div>` : `
    <div class="acoes-pauta">
      ${seloStatus(ideia.Status)}
      <button class="btn btn-secundario btn-pequeno" id="btnRelatorio" title="Sugestões, comentários e encaminhamentos da pauta, prontos para imprimir ou salvar em PDF">Relatório</button>
    </div>`;

  det.innerHTML = `
    <div class="detalhe-cab">
      <div class="detalhe-cab-topo">
        <h2>${esc(ideia.Titulo)}</h2>
        ${acoes}
      </div>
      <div class="meta">Criada em ${fmtData(ideia.Data_Criacao, true)}${ideia.Autor ? " por " + esc(ideia.Autor) : ""}</div>
      ${ideia.Descricao ? `<p class="descricao">${esc(ideia.Descricao)}${ideia.Descricao_Completa === false && !carregado ? "…" : ""}</p>` : ""}
    </div>
    <nav class="abas" role="tablist">
      ${aba("discussao", "Sugestões", nSugestoes)}
      ${aba("encaminhamentos", "Encaminhamentos", nEncs)}
      ${aba("texto", "Texto oficial", ideia.Link_Doc_Oficial ? "✓" : "")}
    </nav>
    <div class="painel">
      ${estado.aba === "texto" ? painelTexto(ideia) : !carregado
        ? `<div class="carregando-painel"><span class="mini-spinner" aria-hidden="true"></span>Aguarde...</div>`
        : estado.aba === "encaminhamentos" ? painelEncaminhamentos(ideia, encs) : painelDiscussao(ideia, interacoes, carregado.curtidas || [])}
    </div>`;
}

function aba(id, rotulo, contador) {
  return `<button class="aba ${estado.aba === id ? "ativa" : ""}" data-aba="${id}" role="tab">${rotulo}${contador !== "" ? `<span class="contador">${contador}</span>` : ""}</button>`;
}

function botaoExcluir(i) {
  return podeExcluirInteracoes() && i.ID_Interacao
    ? `<button type="button" class="btn-excluir" data-excluir="${esc(i.ID_Interacao)}" title="Excluir ${i.Tipo === "Sugestão" ? "sugestão" : "comentário"}" aria-label="Excluir">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
       </button>`
    : "";
}

function cabecalhoInteracao(i) {
  const excluir = botaoExcluir(i);
  return `
      <div class="interacao-cab">
        <strong>${esc(i.Autor)}</strong>
        <span>${fmtData(i.Data, true)}</span>
        ${excluir}
      </div>
      <p>${formatarTexto(i.Texto)}</p>`;
}

const dicaMencao = () => estado.dados.usuarios.length
  ? "Digite <strong>@</strong> para citar um usuário. Ele será avisado para dar encaminhamento."
  : "Peça ao administrador para cadastrar usuários e poder citá-los com @.";

function botaoCurtir(sugestao, curtidas) {
  const daSugestao = curtidas.filter(c => String(c.ID_Interacao) === String(sugestao.ID_Interacao));
  const eu = String(estado.usuario?.apelido || "").toLowerCase();
  const curti = !!eu && daSugestao.some(c => String(c.Apelido).toLowerCase() === eu);
  const quem = daSugestao.map(c => c.Nome || "@" + c.Apelido).join(", ");
  const dica = quem ? `Curtido por ${quem}` : "Ninguém curtiu ainda";
  const icone = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9h3zm3 9h7.2a2 2 0 0 0 2-1.6l1.2-6A2 2 0 0 0 18.4 10H14l.7-3.6A1.8 1.8 0 0 0 13 4.3L10 11v9z" fill="${curti ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  if (!podeInteragir()) return `<span class="btn-curtir" title="${esc(dica)}">${icone}${daSugestao.length}</span>`;
  return `<button type="button" class="btn-curtir ${curti ? "curtido" : ""}" data-curtir="${esc(sugestao.ID_Interacao)}" aria-pressed="${curti}" title="${esc(dica)}">${icone}${curti ? "Curtido" : "Curtir"}${daSugestao.length ? ` · ${daSugestao.length}` : ""}</button>`;
}

function painelDiscussao(ideia, interacoes, curtidas = []) {
  const porData = (a, b) => String(a.Data).localeCompare(String(b.Data));
  const ids = new Set(interacoes.map(i => String(i.ID_Interacao)));
  const sugestoes = interacoes.filter(i => i.Tipo === "Sugestão" && !i.ID_Pai).sort(porData);
  // Registros antigos, de antes dos comentários pertencerem a uma sugestão
  const avulsos = interacoes.filter(i => i.Tipo !== "Sugestão" && !(i.ID_Pai && ids.has(String(i.ID_Pai)))).sort(porData);
  const comentariosDe = id => interacoes.filter(i => String(i.ID_Pai) === String(id)).sort(porData);

  const cards = sugestoes.map(s => {
    const comentarios = comentariosDe(s.ID_Interacao);
    const responder = podeInteragir() ? `
      <form class="form-comentario" data-pai="${esc(s.ID_Interacao)}">
        <textarea class="campo-mencao" rows="1" placeholder="Comentar esta sugestão..." maxlength="5000" required></textarea>
        <button class="btn btn-secundario btn-pequeno" type="submit">Comentar</button>
      </form>` : "";
    const nCurtidas = curtidas.filter(c => String(c.ID_Interacao) === String(s.ID_Interacao)).length;
    const aberta = estado.sugestoesAbertas.has(String(s.ID_Interacao));
    // Fechada: autor, começo do texto e contadores. Aberta: texto inteiro, curtir e comentários.
    return `
      <details class="interacao sugestao acordeom ${citaEu(s.Texto) ? "cita-voce" : ""}" id="int-${esc(s.ID_Interacao)}" data-sugestao="${esc(s.ID_Interacao)}" ${aberta ? "open" : ""}>
        <summary>
          <div class="interacao-cab">
            <strong>${esc(s.Autor)}</strong>
            <span>${fmtData(s.Data, true)}</span>
            <span class="contadores">
              <span title="Curtidas"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9h3zm3 9h7.2a2 2 0 0 0 2-1.6l1.2-6A2 2 0 0 0 18.4 10H14l.7-3.6A1.8 1.8 0 0 0 13 4.3L10 11v9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>${nCurtidas}<span class="sr-only"> curtida(s)</span></span>
              <span title="Comentários"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>${comentarios.length}<span class="sr-only"> comentário(s)</span></span>
            </span>
            <svg class="seta" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <p class="previa">${formatarTexto(s.Texto)}</p>
        </summary>
        <p class="texto-completo">${formatarTexto(s.Texto)}</p>
        <div class="reacoes">${botaoCurtir(s, curtidas)}${botaoExcluir(s)}</div>
        <div class="comentarios">
          <div class="comentarios-titulo">${comentarios.length ? `${comentarios.length} comentário${comentarios.length > 1 ? "s" : ""}` : "Nenhum comentário ainda"}</div>
          ${comentarios.map(c => `
            <div class="comentario ${citaEu(c.Texto) ? "cita-voce" : ""}" id="int-${esc(c.ID_Interacao)}">
              ${cabecalhoInteracao(c)}
            </div>`).join("")}
          ${responder}
        </div>
      </details>`;
  }).join("");

  const lista = sugestoes.length ? cards : `<p class="texto-vazio">Nenhuma sugestão ainda.${podeEscrever() ? " Registre a primeira abaixo." : ""}</p>`;

  const blocoAvulsos = avulsos.length ? `
    <details class="avulsos">
      <summary>Comentários gerais anteriores (${avulsos.length})</summary>
      <div class="linha-tempo">
        ${avulsos.map(c => `<div class="interacao ${citaEu(c.Texto) ? "cita-voce" : ""}" id="int-${esc(c.ID_Interacao)}">${cabecalhoInteracao(c)}</div>`).join("")}
      </div>
    </details>` : "";

  const form = podeEscrever() ? `
    <form class="form-inline" id="formInteracao">
      <label for="iTexto" style="margin:0">Nova sugestão <span class="dica-mencao" style="font-weight:400">— registrando como <strong>${esc(estado.usuario ? estado.usuario.nome : "")}</strong></span></label>
      <textarea id="iTexto" class="campo-mencao" rows="3" placeholder="Descreva sua sugestão para esta pauta... Use @ para citar alguém." maxlength="5000" required></textarea>
      <div class="rodape" style="justify-content:space-between;align-items:center">
        <p class="dica-mencao">${dicaMencao()}</p>
        <button class="btn btn-primario" type="submit">Registrar sugestão</button>
      </div>
    </form>` : "";

  return `<div class="linha-tempo">${lista}</div>` + blocoAvulsos + form;
}

function painelEncaminhamentos(ideia, encs) {
  const lista = [...encs].sort((a, b) => (prazoISO(a.Prazo) || "9999").localeCompare(prazoISO(b.Prazo) || "9999"));

  const linhas = lista.map(e => {
    const statusCel = podeEscrever()
      ? `<select data-enc="${esc(e.ID_Encaminhamento)}" aria-label="Status">
           ${estado.listas.STATUS_ENCAMINHAMENTO.map(s => `<option ${s === e.Status ? "selected" : ""}>${esc(s)}</option>`).join("")}
         </select>`
      : seloStatus(e.Status);
    return `
      <tr>
        <td>${esc(e.Acao)}</td>
        <td>${esc(e.Responsavel)}</td>
        <td class="${atrasado(e) ? "prazo-atrasado" : ""}">${fmtData(prazoISO(e.Prazo)) || "—"}${atrasado(e) ? " ⚠" : ""}</td>
        <td>${statusCel}</td>
      </tr>`;
  }).join("");

  const tabela = lista.length ? `
    <table class="tabela">
      <thead><tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>` : `<p class="texto-vazio">Nenhum encaminhamento registrado.</p>`;

  const ia = podeEscrever() ? blocoIaEncaminhamentos(ideia) : "";

  const origem = estado.citacaoOrigem
    ? estado.dados.citacoes.find(c => c.ID_Citacao === estado.citacaoOrigem && String(c.ID_Ideia) === String(ideia.ID_Ideia))
    : null;
  const form = podeEscrever() ? `
    <form class="form-inline" id="formEncaminhamento">
      ${origem ? `<div class="ia-bloco ia-sintese"><small style="margin:0">Respondendo à citação de <strong>${esc(origem.Autor)}</strong>:</small><p>${formatarTexto(origem.Trecho)}</p></div>` : ""}
      <textarea id="eAcao" rows="2" placeholder="O que deve ser feito?" maxlength="2000" required></textarea>
      <div class="linha tres">
        <input type="text" id="eResponsavel" placeholder="Responsável" maxlength="120" list="dlUsuarios" value="${origem && meuUsuario() ? esc(meuUsuario().Nome) : ""}" required>
        <input type="date" id="ePrazo" aria-label="Prazo">
        <button class="btn btn-primario" type="submit">Encaminhar</button>
      </div>
    </form>` : "";

  return ia + tabela + form;
}

function blocoIaEncaminhamentos(ideia) {
  const sug = estado.iaEncaminhamentos[ideia.ID_Ideia];
  const cab = `
    <div class="ia-cab">
      <span class="nota-ia" style="margin:0">A IA sintetiza a discussão e propõe encaminhamentos.</span>
      <button class="btn btn-ia btn-pequeno" id="btnIaEnc">✦ ${sug ? "Gerar novamente" : "Sugerir com IA"}</button>
    </div>`;
  if (!sug) return cab;

  return cab + `<div class="ia-resultado" style="margin:0 0 16px">
    ${sug.sintese ? `<div class="ia-bloco ia-sintese"><h4>Síntese da discussão</h4><p>${esc(sug.sintese)}</p>${sug.recomendacoes ? `<small class="ia-regras">Seguindo ${sug.recomendacoes} metadado(s) da coordenação.</small>` : ""}${textoInfoIA(sug.ia)}</div>` : ""}
    ${sug.encaminhamentos.map((e, idx) => `
      <div class="ia-bloco ${e.adotado ? "adotado" : ""}">
        <p>${esc(e.acao)}</p>
        <div class="rodape">
          <input type="text" data-ia-resp="${idx}" placeholder="Responsável" list="dlUsuarios" value="${esc(e.responsavel || "")}" ${e.adotado ? "disabled" : ""}>
          <input type="date" data-ia-prazo="${idx}" value="${e.prazo}" ${e.adotado ? "disabled" : ""}>
          <button class="btn btn-primario btn-pequeno" data-ia-adotar="${idx}" ${e.adotado ? "disabled" : ""}>${e.adotado ? "Adotado ✓" : "Adotar"}</button>
        </div>
      </div>`).join("")}
  </div>`;
}

function painelTexto(ideia) {
  const link = ideia.Link_Doc_Oficial;
  const preview = link ? linkPreview(link) : "";
  const doc = link ? `
    <div class="doc-oficial">
      <div class="doc-icone" aria-hidden="true"></div>
      <div class="info">
        <strong>Texto oficial da pauta</strong>
        <small>${esc(link)}</small>
      </div>
      <a class="btn btn-primario" href="${esc(link)}" target="_blank" rel="noopener">Abrir no Google Docs</a>
    </div>
    ${preview ? `<iframe class="doc-preview" src="${esc(preview)}" title="Pré-visualização do texto oficial" loading="lazy"></iframe>` : ""}`
    : `<p class="texto-vazio">Ainda não há texto oficial vinculado a esta pauta.</p>`;

  const form = podeEscrever() ? `
    <form class="form-inline" id="formTexto">
      <label for="tLink" style="margin:0">${link ? "Alterar link do texto oficial" : "Vincular texto oficial (Google Docs)"}</label>
      <div class="linha" style="grid-template-columns:1fr auto">
        <input type="url" id="tLink" placeholder="https://docs.google.com/document/d/..." value="${esc(link || "")}">
        <button class="btn btn-primario" type="submit">Salvar link</button>
      </div>
    </form>` : "";

  return doc + form;
}

/* ---------------------------------------------------------- */
/* Pautas (modal)                                              */
/* ---------------------------------------------------------- */

let editandoId = null;

function abrirModalPauta(ideia = null) {
  editandoId = ideia ? ideia.ID_Ideia : null;
  $("#modalPautaTitulo").textContent = ideia ? "Editar pauta" : "Nova pauta";
  $("#pTitulo").value = ideia ? ideia.Titulo : "";
  $("#pDescricao").value = ideia ? ideia.Descricao : "";
  $("#pLink").value = ideia ? ideia.Link_Doc_Oficial : "";
  $("#pStatus").value = ideia ? ideia.Status : "Em Debate";
  $("#campoStatus").hidden = !ideia;
  $("#erroPauta").hidden = true;
  $("#modalPauta").showModal();
  $("#pTitulo").focus();
}

async function salvarPauta(ev) {
  ev.preventDefault();
  const dados = {
    titulo: $("#pTitulo").value,
    descricao: $("#pDescricao").value,
    linkDoc: $("#pLink").value.trim()
  };
  let r;
  if (editandoId) {
    r = await gravar("EDITAR_IDEIA", { ...dados, idIdeia: editandoId, status: $("#pStatus").value });
  } else {
    r = await gravar("CRIAR_IDEIA", { ...dados, idGrupo: estado.grupo });
    if (r && r.id) { estado.selecionada = r.id; estado.aba = "discussao"; renderizarTudo(); }
  }
  if (r) $("#modalPauta").close();
}

/* ---------------------------------------------------------- */
/* IA — sugerir pautas                                         */
/* ---------------------------------------------------------- */

let sugestoesPautas = [];

async function gerarSugestoesPautas(ev) {
  ev.preventDefault();
  const r = await apiComSenhaIA("IA_SUGERIR_PAUTAS", { tema: $("#iaTema").value, idGrupo: estado.grupo });
  if (!r) return;
  if (r.status !== "success") return aviso(r.message, true);
  sugestoesPautas = r.sugestoes || [];
  infoPautasIA = r.ia || null;
  renderizarSugestoesPautas();
}

let infoPautasIA = null;

/** "Gemini (gemini-2.5-flash) · 8 s" — ajuda a ver qual IA respondeu e quanto demorou. */
const textoInfoIA = ia => ia && ia.provedor
  ? `<small class="ia-regras">Respondido por ${esc(ia.provedor)}${ia.modelo ? ` (${esc(ia.modelo)})` : ""}${ia.segundos !== undefined ? ` em ${ia.segundos} s` : ""}.</small>`
  : "";

function renderizarSugestoesPautas() {
  $("#iaResultado").innerHTML = sugestoesPautas.length ? sugestoesPautas.map((s, idx) => `
    <div class="ia-bloco ${s.adotado ? "adotado" : ""}">
      <h4>${esc(s.titulo)}</h4>
      <p>${esc(s.descricao)}</p>
      ${s.justificativa ? `<small>Por quê: ${esc(s.justificativa)}</small>` : ""}
      <div class="rodape">
        <button class="btn btn-primario btn-pequeno" data-adotar-pauta="${idx}" ${s.adotado ? "disabled" : ""}>${s.adotado ? "Adotada ✓" : "Adotar como pauta"}</button>
      </div>
    </div>`).join("") + textoInfoIA(infoPautasIA) : `<p class="texto-vazio">A IA não retornou sugestões. Tente outro foco.</p>`;
}

async function adotarPauta(idx) {
  const s = sugestoesPautas[idx];
  const r = await gravar("CRIAR_IDEIA", { titulo: s.titulo, descricao: s.descricao, idGrupo: estado.grupo });
  if (r) { s.adotado = true; renderizarSugestoesPautas(); }
}

/* ---------------------------------------------------------- */
/* IA — sugerir encaminhamentos                                */
/* ---------------------------------------------------------- */

// Senha da IA digitada nesta aba: pedida no primeiro uso e lembrada até recarregar a página
let senhaIA = "";

/**
 * Chama uma ação de IA com a senha da IA. Pede a senha se ainda não foi digitada e,
 * se o servidor recusar, esquece a senha para pedir de novo na próxima vez.
 */
async function apiComSenhaIA(acao, dados) {
  if (!senhaIA) {
    const senha = await pedirSenha({ titulo: "Senha da IA", mensagem: "", rotulo: "Digite a senha para usar a IA", botao: "Usar a IA" });
    if (senha === null) return null;
    senhaIA = senha;
  }
  const r = await api(acao, { ...dados, senhaIA });
  if (r.codigo === "SENHA_IA") senhaIA = "";
  return r;
}

async function gerarSugestoesEncaminhamentos() {
  const id = estado.selecionada;
  const r = await apiComSenhaIA("IA_SUGERIR_ENCAMINHAMENTOS", { idIdeia: id });
  if (!r) return;
  if (r.status !== "success") return aviso(r.message, true);
  estado.iaEncaminhamentos[id] = {
    sintese: r.sintese,
    recomendacoes: Number(r.recomendacoesAplicadas) || 0,
    ia: r.ia || null,
    encaminhamentos: (r.encaminhamentos || []).map(e => ({
      acao: e.acao,
      responsavel: e.responsavel || "",
      prazo: hojeISO(Number(e.prazoDias) > 0 ? Number(e.prazoDias) : 7)
    }))
  };
  renderizarDetalhe();
}

async function adotarEncaminhamento(idx) {
  const id = estado.selecionada;
  const sug = estado.iaEncaminhamentos[id].encaminhamentos[idx];
  sug.responsavel = $(`[data-ia-resp="${idx}"]`).value.trim();
  sug.prazo = $(`[data-ia-prazo="${idx}"]`).value;
  if (!sug.responsavel) return aviso("Informe o responsável antes de adotar.", true);
  const r = await gravar("ADD_ENCAMINHAMENTO", { idIdeia: id, acaoTexto: sug.acao, responsavel: sug.responsavel, prazo: sug.prazo });
  if (r) { sug.adotado = true; renderizarDetalhe(); }
}

/* ---------------------------------------------------------- */
/* Exclusão (somente administrador)                            */
/* ---------------------------------------------------------- */

/**
 * Curte ou descurte na hora (sem cobrir a tela) e confirma com o servidor;
 * se o servidor recusar, a tela volta ao que era.
 */
const curtindo = new Set();

async function curtirSugestao(idInteracao) {
  const idIdeia = estado.selecionada;
  const det = detalheDe(idIdeia);
  if (!det || !podeInteragir() || curtindo.has(idInteracao)) return;
  curtindo.add(idInteracao);
  try { await enviarCurtida(det, idIdeia, idInteracao); } finally { curtindo.delete(idInteracao); }
}

async function enviarCurtida(det, idIdeia, idInteracao) {
  const eu = String(estado.usuario.apelido).toLowerCase();
  const antes = det.curtidas || [];
  const minha = c => String(c.ID_Interacao) === String(idInteracao) && String(c.Apelido).toLowerCase() === eu;
  det.curtidas = antes.some(minha) ? antes.filter(c => !minha(c)) : [...antes, { ID_Interacao: idInteracao, Apelido: eu, Nome: estado.usuario.nome }];
  renderizarDetalhe();

  const r = await api("CURTIR", { idIdeia, idInteracao }, { silencioso: true });
  if (sessaoExpirou(r)) return;
  if (r.status !== "success") {
    det.curtidas = antes;
    renderizarDetalhe();
    return aviso(r.message || "Não foi possível registrar a curtida.", true);
  }
  aplicarResposta(r);
  renderizarTudo();
}

async function excluirInteracao(id) {
  const det = detalheDe(estado.selecionada);
  const interacoes = det ? det.interacoes : [];
  const item = interacoes.find(i => String(i.ID_Interacao) === String(id));
  if (!item) return;
  const resumo = String(item.Texto).slice(0, 80) + (String(item.Texto).length > 80 ? "…" : "");
  let msg;
  if (item.Tipo === "Sugestão") {
    const n = interacoes.filter(i => String(i.ID_Pai) === String(id)).length;
    msg = `Excluir esta sugestão de ${item.Autor}${n ? ` e os ${n} comentário(s) dela` : ""}?\n\n"${resumo}"\n\nEsta ação não pode ser desfeita.`;
  } else {
    msg = `Excluir este comentário de ${item.Autor}?\n\n"${resumo}"\n\nEsta ação não pode ser desfeita.`;
  }
  const senha = await pedirSenhaExclusao(msg);
  if (senha === null) return;
  await gravar("EXCLUIR_INTERACAO", { idInteracao: id, idIdeia: estado.selecionada, senha });
}

/* ---------------------------------------------------------- */
/* Relatório da pauta (imprimir ou salvar em PDF)              */
/* ---------------------------------------------------------- */

let relatorioAtual = "";

/** Mostra o relatório dentro do sistema (sem pop-up, que muitos navegadores bloqueiam). */
async function gerarRelatorio(idIdeia) {
  // Busca a versão mais recente da pauta antes de montar
  await carregarDetalhe(idIdeia);
  const det = detalheDe(idIdeia);
  if (!det) return aviso("Não foi possível carregar a pauta para o relatório.", true);
  relatorioAtual = htmlRelatorio(ideiaCompleta(idIdeia), det);
  $("#relatorioTitulo").textContent = "Relatório da pauta";
  $("#relatorioFrame").srcdoc = relatorioAtual;
  $("#modalRelatorio").showModal();
}

/** Relatório de todas as pautas do GT aberto: carrega cada uma (com progresso no loading) e monta. */
async function gerarRelatorioGrupo() {
  const grupo = grupoAtual();
  if (!grupo) return;
  const ideias = ideiasDoGrupo().sort((a, b) => String(a.Data_Criacao).localeCompare(String(b.Data_Criacao)));
  const faltando = ideias.filter(i => !detalheDe(i.ID_Ideia));

  mostrarLoading("RELATORIO_GT");
  try {
    // Até 3 pautas por vez, para não sobrecarregar o Apps Script
    let prontas = ideias.length - faltando.length;
    const avancar = () => definirProgressoLoading(`Carregando as pautas do GT: ${prontas} de ${ideias.length}...`);
    avancar();
    const fila = [...faltando];
    await Promise.all(Array.from({ length: Math.min(3, fila.length) }, async () => {
      while (fila.length) {
        await carregarDetalhe(fila.shift().ID_Ideia);
        prontas++;
        avancar();
      }
    }));
    definirProgressoLoading("Montando o relatório...");
    const pautas = ideias.map(i => ({ ideia: ideiaCompleta(i.ID_Ideia), det: detalheDe(i.ID_Ideia) })).filter(p => p.det);
    if (pautas.length < ideias.length) aviso(`${ideias.length - pautas.length} pauta(s) não carregaram e ficaram fora do relatório. Tente de novo.`, true);
    relatorioAtual = htmlRelatorioGrupo(grupo, pautas);
  } finally {
    definirProgressoLoading(null);
    esconderLoading();
  }
  $("#relatorioTitulo").textContent = `Relatório do GT · ${grupo.Nome}`;
  $("#relatorioFrame").srcdoc = relatorioAtual;
  $("#modalRelatorio").showModal();
}

function imprimirRelatorio() {
  const frame = $("#relatorioFrame").contentWindow;
  frame.focus();
  frame.print();
}

function abrirRelatorioEmAba() {
  const url = URL.createObjectURL(new Blob([relatorioAtual], { type: "text/html;charset=utf-8" }));
  const aba = window.open(url, "_blank");
  if (!aba) aviso("O navegador bloqueou a nova aba. Use Imprimir / Salvar PDF.", true);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const ESTILO_RELATORIO = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f7f4f4; color: #1c2430; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .folha { max-width: 820px; margin: 24px auto; background: #fff; padding: 40px 48px; border-radius: 10px; box-shadow: 0 1px 3px rgba(16,24,40,.1); }
  .topo { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #7a1f2b; padding-bottom: 14px; }
  .topo img { width: 44px; height: auto; }
  .topo .sis { font-size: 12px; color: #5d6b7e; text-transform: uppercase; letter-spacing: .06em; }
  h1 { font-size: 22px; margin: 18px 0 4px; color: #7a1f2b; }
  h2 { font-size: 15px; margin: 28px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #dde3ec; color: #5c1520; text-transform: uppercase; letter-spacing: .04em; }
  .info { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; font-size: 13px; color: #5d6b7e; margin-top: 8px; }
  .info b { color: #1c2430; font-weight: 600; }
  .descricao { white-space: normal; margin: 12px 0 0; }
  .numeros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; }
  .numeros div { border: 1px solid #dde3ec; border-radius: 8px; padding: 8px 10px; }
  .numeros strong { display: block; font-size: 20px; color: #7a1f2b; }
  .numeros span { font-size: 12px; color: #5d6b7e; }
  .sintese { background: #f4effb; border-left: 3px solid #6b3fb0; padding: 10px 14px; border-radius: 6px; }
  .sintese small { display: block; color: #5d6b7e; margin-top: 6px; }
  .sugestao { border: 1px solid #f0dc8f; border-left: 3px solid #e6c75a; background: #fffcf0; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; break-inside: avoid; }
  header { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
  header span { color: #5d6b7e; white-space: nowrap; }
  .sugestao > p, li p { margin: 6px 0 0; }
  .meta { font-size: 12px; color: #5d6b7e; margin-top: 8px; }
  .comentarios { list-style: none; margin: 10px 0 0; padding: 0 0 0 14px; border-left: 2px solid #f6e8ea; display: grid; gap: 8px; }
  .comentarios li { background: #fff; border: 1px solid #eceff4; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
  .soltos { padding-left: 0; border-left: none; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #dde3ec; vertical-align: top; }
  th { background: #f6e8ea; color: #5c1520; font-size: 12px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.atrasado td { color: #b42318; }
  .vazio { color: #5d6b7e; font-style: italic; }
  .pauta { margin-top: 40px; padding-top: 8px; border-top: 3px solid #f6e8ea; }
  .pauta .ordem { font-size: 12px; color: #5d6b7e; text-transform: uppercase; letter-spacing: .06em; margin-top: 12px; }
  .pauta h1 { margin-top: 2px; }
  .rodape { margin-top: 32px; padding-top: 10px; border-top: 1px solid #dde3ec; font-size: 11px; color: #5d6b7e; display: flex; justify-content: space-between; gap: 12px; }
  a { color: #2459a8; word-break: break-all; }
  @media (max-width: 640px) { .folha { padding: 24px 16px; margin: 12px 0; border-radius: 0; } .numeros { grid-template-columns: repeat(2, 1fr); } }
  @media print {
    @page { margin: 16mm; }
    body { background: #fff; }
    .folha { box-shadow: none; margin: 0; padding: 0; max-width: none; }
    .pauta { break-before: page; border-top: none; margin-top: 0; padding-top: 0; }
    .sugestao, .sintese, th, .numeros div { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }`;

const textoRelatorio = t => esc(t).replace(/\n/g, "<br>");
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** Números e listas de uma pauta, usados no relatório da pauta e no do GT. */
function dadosDaPauta(det) {
  const porData = (a, b) => String(a.Data).localeCompare(String(b.Data));
  const interacoes = det.interacoes || [];
  const ids = new Set(interacoes.map(i => String(i.ID_Interacao)));
  const encs = [...(det.encaminhamentos || [])].sort((a, b) => (prazoISO(a.Prazo) || "9999").localeCompare(prazoISO(b.Prazo) || "9999"));
  return {
    interacoes,
    curtidas: det.curtidas || [],
    encs,
    sugestoes: interacoes.filter(i => i.Tipo === "Sugestão" && !i.ID_Pai).sort(porData),
    avulsos: interacoes.filter(i => i.Tipo !== "Sugestão" && !(i.ID_Pai && ids.has(String(i.ID_Pai)))).sort(porData),
    comentariosDe: id => interacoes.filter(i => String(i.ID_Pai) === String(id)).sort(porData),
    nComentarios: interacoes.filter(i => i.ID_Pai && ids.has(String(i.ID_Pai))).length,
    nAtrasados: encs.filter(atrasado).length
  };
}

/** Conteúdo de uma pauta: dados, números, síntese, sugestões com comentários e encaminhamentos. */
function corpoPauta(ideia, det, { comGrupo = true } = {}) {
  const d = dadosDaPauta(det);
  const grupo = (estado.dados.grupos || []).find(g => String(g.ID_Grupo) === grupoDe(ideia));
  const sintese = (estado.iaEncaminhamentos[ideia.ID_Ideia] || {}).sintese;
  const curtidasDe = id => d.curtidas.filter(c => String(c.ID_Interacao) === String(id));

  const blocoSugestoes = d.sugestoes.length ? d.sugestoes.map((s, n) => {
    const coms = d.comentariosDe(s.ID_Interacao);
    const curt = curtidasDe(s.ID_Interacao);
    return `
      <article class="sugestao">
        <header><strong>${n + 1}. ${esc(s.Autor)}</strong><span>${fmtData(s.Data, true)}</span></header>
        <p>${textoRelatorio(s.Texto)}</p>
        <div class="meta">${plural(curt.length, "curtida", "curtidas")}${curt.length ? ` (${esc(curt.map(c => c.Nome || "@" + c.Apelido).join(", "))})` : ""} · ${plural(coms.length, "comentário", "comentários")}</div>
        ${coms.length ? `<ul class="comentarios">${coms.map(c => `
          <li><header><strong>${esc(c.Autor)}</strong><span>${fmtData(c.Data, true)}</span></header><p>${textoRelatorio(c.Texto)}</p></li>`).join("")}
        </ul>` : ""}
      </article>`;
  }).join("") : `<p class="vazio">Nenhuma sugestão registrada.</p>`;

  const blocoAvulsos = d.avulsos.length ? `
    <h2>Comentários gerais anteriores</h2>
    <ul class="comentarios soltos">${d.avulsos.map(c => `
      <li><header><strong>${esc(c.Autor)}</strong><span>${fmtData(c.Data, true)}</span></header><p>${textoRelatorio(c.Texto)}</p></li>`).join("")}
    </ul>` : "";

  const blocoEncs = d.encs.length ? `
    <table>
      <thead><tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr></thead>
      <tbody>${d.encs.map(e => `
        <tr class="${atrasado(e) ? "atrasado" : ""}">
          <td>${textoRelatorio(e.Acao)}</td>
          <td>${esc(e.Responsavel || "—")}</td>
          <td>${fmtData(prazoISO(e.Prazo)) || "—"}${atrasado(e) ? "<br><small>atrasado</small>" : ""}</td>
          <td>${esc(e.Status)}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<p class="vazio">Nenhum encaminhamento registrado.</p>`;

  return `
    <h1>${esc(ideia.Titulo)}</h1>
    <div class="info">
      ${comGrupo ? `<span>Grupo de trabalho</span><b>${esc(grupo ? grupo.Nome : "—")}</b>` : ""}
      <span>Status</span><b>${esc(ideia.Status || "—")}</b>
      <span>Criada em</span><b>${fmtData(ideia.Data_Criacao, true)}${ideia.Autor ? " por " + esc(ideia.Autor) : ""}</b>
      ${ideia.Link_Doc_Oficial ? `<span>Texto oficial</span><b><a href="${esc(ideia.Link_Doc_Oficial)}">${esc(ideia.Link_Doc_Oficial)}</a></b>` : ""}
    </div>
    ${ideia.Descricao ? `<p class="descricao">${textoRelatorio(ideia.Descricao)}</p>` : ""}

    <div class="numeros">
      <div><strong>${d.sugestoes.length}</strong><span>sugestões</span></div>
      <div><strong>${d.nComentarios}</strong><span>comentários</span></div>
      <div><strong>${d.curtidas.length}</strong><span>curtidas</span></div>
      <div><strong>${d.encs.length}</strong><span>encaminhamentos${d.nAtrasados ? ` (${plural(d.nAtrasados, "atrasado", "atrasados")})` : ""}</span></div>
    </div>

    ${sintese ? `<h2>Síntese da discussão (IA)</h2><div class="sintese">${textoRelatorio(sintese)}<small>Gerada pela IA nesta sessão. Confira antes de usar como registro oficial.</small></div>` : ""}

    <h2>Sugestões e comentários</h2>
    ${blocoSugestoes}
    ${blocoAvulsos}

    <h2>Encaminhamentos</h2>
    ${blocoEncs}`;
}

/** Página completa do relatório: cabeçalho com logo, conteúdo e rodapé. */
function paginaRelatorio(tituloAba, subtitulo, corpo) {
  const logo = new URL("logo.svg", location.href).href;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tituloAba)}</title>
<style>${ESTILO_RELATORIO}</style>
</head>
<body>
  <main class="folha">
    <div class="topo">
      <img src="${esc(logo)}" alt="">
      <div><div class="sis">Sistema de Apoio a Reuniões</div><strong>${esc(subtitulo)}</strong></div>
    </div>
    ${corpo}
    <div class="rodape">
      <span>Gerado em ${fmtData(new Date().toISOString(), true)}${estado.usuario ? " por " + esc(estado.usuario.nome) : ""}</span>
      <span>Sistema de Apoio a Reuniões · GTIC Hemobrás</span>
    </div>
  </main>
</body>
</html>`;
}

function htmlRelatorio(ideia, det) {
  return paginaRelatorio(`Relatório · ${ideia.Titulo}`, "Relatório da pauta", corpoPauta(ideia, det));
}

/** Relatório do GT: resumo de todas as pautas e, em seguida, cada pauta completa (uma por página na impressão). */
function htmlRelatorioGrupo(grupo, pautas) {
  const linhas = pautas.map(({ ideia, det }) => ({ ideia, d: dadosDaPauta(det) }));
  const soma = campo => linhas.reduce((t, l) => t + campo(l.d), 0);
  const porStatus = estado.listas.STATUS_IDEIA
    .map(s => [s, pautas.filter(p => p.ideia.Status === s).length])
    .filter(([, n]) => n)
    .map(([s, n]) => `${esc(s)}: ${n}`).join(" · ");

  const resumo = `
    <h1>${esc(grupo.Nome)}</h1>
    <div class="info">
      ${grupo.Descricao ? `<span>Objetivo</span><b>${esc(grupo.Descricao)}</b>` : ""}
      <span>Pautas</span><b>${pautas.length}${porStatus ? ` (${porStatus})` : ""}</b>
    </div>

    <div class="numeros">
      <div><strong>${soma(d => d.sugestoes.length)}</strong><span>sugestões</span></div>
      <div><strong>${soma(d => d.nComentarios)}</strong><span>comentários</span></div>
      <div><strong>${soma(d => d.curtidas.length)}</strong><span>curtidas</span></div>
      <div><strong>${soma(d => d.encs.length)}</strong><span>encaminhamentos${soma(d => d.nAtrasados) ? ` (${plural(soma(d => d.nAtrasados), "atrasado", "atrasados")})` : ""}</span></div>
    </div>

    <h2>Resumo das pautas</h2>
    ${linhas.length ? `<table>
      <thead><tr><th>#</th><th>Pauta</th><th>Status</th><th class="num">Sugestões</th><th class="num">Comentários</th><th class="num">Encaminhamentos</th></tr></thead>
      <tbody>${linhas.map(({ ideia, d }, n) => `
        <tr class="${d.nAtrasados ? "atrasado" : ""}">
          <td>${n + 1}</td>
          <td>${esc(ideia.Titulo)}</td>
          <td>${esc(ideia.Status || "—")}</td>
          <td class="num">${d.sugestoes.length}</td>
          <td class="num">${d.nComentarios}</td>
          <td class="num">${d.encs.length}${d.nAtrasados ? `<br><small>${plural(d.nAtrasados, "atrasado", "atrasados")}</small>` : ""}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<p class="vazio">Nenhuma pauta neste grupo.</p>`}`;

  const detalhes = pautas.map(({ ideia, det }, n) => `
    <section class="pauta">
      <div class="ordem">Pauta ${n + 1} de ${pautas.length}</div>
      ${corpoPauta(ideia, det, { comGrupo: false })}
    </section>`).join("");

  return paginaRelatorio(`Relatório · ${grupo.Nome}`, "Relatório do grupo de trabalho", resumo + detalhes);
}

/* ---------------------------------------------------------- */
/* Citações                                                    */
/* ---------------------------------------------------------- */

function renderizarCitacoes() {
  const eu = meuUsuario();
  const sub = $("#citacoesSub");
  const lista = $("#listaCitacoes");
  document.querySelectorAll("#filtroCitacoes .chip").forEach(c => c.classList.toggle("ativo", c.dataset.fcit === estado.filtroCitacoes));

  if (!eu) {
    sub.textContent = "";
    lista.innerHTML = `<p class="texto-vazio">Escolha quem é você no campo "Você é", no topo da tela, para ver as suas citações.</p>`;
    return;
  }
  const todas = minhasCitacoes();
  const pend = todas.filter(c => c.Status === "Pendente").length;
  sub.innerHTML = `Olá, <strong>${esc(eu.Nome)}</strong> (@${esc(eu.Apelido)}). Você tem <strong>${pend}</strong> citação(ões) pendente(s).`;

  const filtradas = todas.filter(c => !estado.filtroCitacoes || c.Status === estado.filtroCitacoes);
  if (!filtradas.length) {
    lista.innerHTML = `<p class="texto-vazio">${estado.filtroCitacoes ? "Nenhuma citação pendente. Tudo em dia!" : "Você ainda não foi citado(a)."}</p>`;
    return;
  }
  lista.innerHTML = filtradas.map(c => {
    const ideia = estado.dados.ideias.find(i => String(i.ID_Ideia) === String(c.ID_Ideia));
    const acoes = podeEscrever() && c.Status === "Pendente" ? `
      <button class="btn btn-primario btn-pequeno" data-cit-enc="${esc(c.ID_Citacao)}">Criar encaminhamento</button>
      <button class="btn btn-secundario btn-pequeno" data-cit-resolver="${esc(c.ID_Citacao)}">Marcar como resolvida</button>` : "";
    return `
      <div class="ia-bloco citacao">
        <div class="pauta-topo">
          <h4><a href="#" data-cit-ver="${esc(c.ID_Citacao)}">${esc(ideia ? ideia.Titulo : "Pauta removida")}</a></h4>
          ${seloStatus(c.Status)}
        </div>
        <p>${formatarTexto(c.Trecho)}</p>
        <div class="meta-cit">${esc(c.Autor)} citou você em ${fmtData(c.Data, true)}</div>
        <div class="rodape">
          <button class="btn btn-secundario btn-pequeno" data-cit-ver="${esc(c.ID_Citacao)}">Ver na pauta</button>
          ${acoes}
        </div>
      </div>`;
  }).join("");
}

async function irParaCitacao(idCitacao, aba) {
  const c = estado.dados.citacoes.find(x => x.ID_Citacao === idCitacao);
  if (!c) return;
  $("#modalCitacoes").close();
  estado.aba = aba;
  estado.filtroTipo = "";
  estado.citacaoOrigem = aba === "encaminhamentos" ? idCitacao : null;
  // A citação pode ser de uma pauta de outro GT: abre o GT certo antes
  const ideia = estado.dados.ideias.find(i => String(i.ID_Ideia) === String(c.ID_Ideia));
  if (ideia && grupoDe(ideia) !== estado.grupo) abrirGrupo(grupoDe(ideia));
  const pendente = selecionarPauta(c.ID_Ideia);
  if (!detalheDe(c.ID_Ideia)) await pendente;
  const alvo = aba === "encaminhamentos" ? $("#eAcao") : document.getElementById("int-" + c.ID_Interacao);
  // A citação pode estar dentro de uma sugestão fechada no acordeom: abre antes de rolar
  const sugestao = alvo && alvo.closest("details[data-sugestao]");
  if (sugestao) sugestao.open = true;
  if (alvo) {
    alvo.scrollIntoView({ behavior: "smooth", block: "center" });
    if (alvo.tagName === "TEXTAREA") alvo.focus();
  }
}

/* ---------------------------------------------------------- */
/* Usuários                                                    */
/* ---------------------------------------------------------- */

function gerarApelido(nome) {
  const partes = String(nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  return partes.length === 1 ? partes[0] : `${partes[0]}.${partes[partes.length - 1]}`;
}

function renderizarUsuarios() {
  const lista = [...estado.dados.usuarios].sort((a, b) => String(a.Nome).localeCompare(String(b.Nome), "pt-BR"));
  const perfis = estado.listas.PERFIS || ["Administrador", "Colaborador", "Leitura"];
  $("#listaUsuarios").innerHTML = lista.length ? lista.map(u => `
    <div class="usuario-linha ${usuarioAtivo(u) ? "" : "inativo"}" data-usr="${esc(u.ID_Usuario)}">
      <div class="info">
        <strong>${esc(u.Nome)}</strong> <span class="mencao">@${esc(u.Apelido)}</span>
        <small>${esc(u.Email || "sem e-mail")}${usuarioAtivo(u) ? "" : " · inativo"}${u.Tem_Senha === false ? ' · <b class="prazo-atrasado">sem senha</b>' : ""}</small>
        <div class="redefinir" hidden>
          <input type="password" placeholder="Nova senha (mín. 6)" minlength="6" autocomplete="new-password">
          <button class="btn btn-primario btn-pequeno" data-usr-salvar-senha>Salvar</button>
        </div>
      </div>
      <select data-usr-perfil aria-label="Perfil">
        ${perfis.map(p => `<option ${p === (u.Perfil || "Colaborador") ? "selected" : ""}>${esc(p)}</option>`).join("")}
      </select>
      <button class="btn btn-secundario btn-pequeno" data-usr-senha>Redefinir senha</button>
      <button class="btn btn-secundario btn-pequeno" data-usr-toggle data-ativo="${usuarioAtivo(u) ? "1" : "0"}">
        ${usuarioAtivo(u) ? "Desativar" : "Reativar"}
      </button>
    </div>`).join("") : `<p class="texto-vazio">Nenhum usuário cadastrado.</p>`;
}

let apelidoEditado = false;

async function salvarUsuario(ev) {
  ev.preventDefault();
  const r = await gravar("CRIAR_USUARIO", {
    nome: $("#uNome").value,
    apelido: $("#uApelido").value.trim(),
    email: $("#uEmail").value.trim(),
    perfil: $("#uPerfil").value,
    senha: $("#uSenha").value
  });
  if (r) {
    $("#formUsuario").reset();
    apelidoEditado = false;
    renderizarUsuarios();
  }
}

/* ---------------------------------------------------------- */
/* Recomendações para a IA (somente administrador)             */
/* ---------------------------------------------------------- */

const nomeDoGrupo = id => !id ? "Todos os GTs"
  : ((estado.dados.grupos || []).find(g => String(g.ID_Grupo) === String(id)) || {}).Nome || id;

function opcoesGrupoRecomendacao(selecionado = "") {
  return [`<option value="">Todos os GTs</option>`, ...(estado.dados.grupos || []).map(g =>
    `<option value="${esc(g.ID_Grupo)}" ${String(g.ID_Grupo) === String(selecionado) ? "selected" : ""}>${esc(g.Nome)}${grupoAtivo(g) ? "" : " (desativado)"}</option>`)].join("");
}

// null = tela geral (todos os GTs); com um ID, a tela vale só para aquele GT
let recGrupoFixo = null;

function limparFormRecomendacao() {
  $("#formRecomendacao").reset();
  $("#rId").value = "";
  $("#rGrupo").innerHTML = opcoesGrupoRecomendacao(recGrupoFixo || "");
  $("#btnSalvarRecomendacao").textContent = "Cadastrar metadado";
  $("#btnCancelarEdicaoRec").hidden = true;
}

/** Abre o cadastro geral ou, com idGrupo, o cadastro já vinculado àquele GT. */
function abrirRecomendacoes(idGrupo = null) {
  recGrupoFixo = idGrupo ? String(idGrupo) : null;
  $("#recTitulo").textContent = recGrupoFixo ? `Metadados para a IA · ${nomeDoGrupo(recGrupoFixo)}` : "Metadados para a IA";
  $("#rGrupo").hidden = !!recGrupoFixo;
  $("#formRecomendacao .linha").style.gridTemplateColumns = recGrupoFixo ? "1fr" : "";
  limparFormRecomendacao();
  renderizarRecomendacoes();
  $("#modalRecomendacoes").showModal();
  $("#rTitulo").focus();
}

function renderizarRecomendacoes() {
  const todas = estado.dados.recomendacoes || [];
  const gerais = todas.filter(r => !r.ID_Grupo && grupoAtivo(r)).length;
  $("#recNotaGerais").hidden = !recGrupoFixo;
  $("#recNotaGerais").innerHTML = recGrupoFixo
    ? `Aqui ficam só os metadados deste GT. ${gerais ? `Também ${gerais === 1 ? "vale 1 metadado" : `valem ${gerais} metadados`} de <strong>todos os GTs</strong>, que ficam no botão Metadados IA do topo.` : ""}`
    : "";
  const lista = todas.filter(r => !recGrupoFixo || String(r.ID_Grupo || "") === recGrupoFixo).sort((a, b) =>
    nomeDoGrupo(a.ID_Grupo).localeCompare(nomeDoGrupo(b.ID_Grupo), "pt-BR") || String(a.Titulo).localeCompare(String(b.Titulo), "pt-BR"));
  $("#listaRecomendacoes").innerHTML = lista.length ? lista.map(r => {
    const ativa = grupoAtivo(r);
    return `
    <div class="usuario-linha recomendacao ${ativa ? "" : "inativo"}" data-rec="${esc(r.ID_Recomendacao)}">
      <div class="info">
        <strong>${esc(r.Titulo)}</strong> <span class="selo-gt">${esc(nomeDoGrupo(r.ID_Grupo))}</span>${ativa ? "" : " <small style=\"display:inline\">· desativado</small>"}
        <small>${esc(r.Texto)}</small>
      </div>
      <button class="btn btn-secundario btn-pequeno" data-rec-editar>Editar</button>
      <button class="btn btn-secundario btn-pequeno" data-rec-toggle data-ativo="${ativa ? "1" : "0"}">${ativa ? "Desativar" : "Reativar"}</button>
      <button class="btn btn-fantasma btn-pequeno" data-rec-excluir>Excluir</button>
    </div>`;
  }).join("") : `<p class="texto-vazio">${recGrupoFixo ? "Nenhum metadado cadastrado para este GT." : "Nenhum metadado cadastrado. A IA usa só a pauta e a discussão."}</p>`;
}

async function salvarRecomendacao(ev) {
  ev.preventDefault();
  const id = $("#rId").value;
  const campos = { titulo: $("#rTitulo").value, texto: $("#rTexto").value, idGrupo: recGrupoFixo || $("#rGrupo").value };
  const r = await gravar(id ? "EDITAR_RECOMENDACAO" : "CRIAR_RECOMENDACAO", id ? { idRecomendacao: id, ...campos } : campos);
  if (r) { limparFormRecomendacao(); renderizarRecomendacoes(); }
}

function editarRecomendacao(id) {
  const r = (estado.dados.recomendacoes || []).find(x => x.ID_Recomendacao === id);
  if (!r) return;
  $("#rId").value = id;
  $("#rTitulo").value = r.Titulo || "";
  $("#rTexto").value = r.Texto || "";
  $("#rGrupo").innerHTML = opcoesGrupoRecomendacao(r.ID_Grupo || "");
  $("#btnSalvarRecomendacao").textContent = "Salvar alterações";
  $("#btnCancelarEdicaoRec").hidden = false;
  $("#rTitulo").focus();
}

/* ---------------------------------------------------------- */
/* Autocompletar de @menção                                    */
/* ---------------------------------------------------------- */

const mencao = { campo: null, inicio: -1, opcoes: [], ativo: 0 };

function atualizarMencao(campo) {
  const ate = campo.value.slice(0, campo.selectionStart);
  const m = ate.match(/(^|\s)@([a-z0-9._-]*)$/i);
  if (!m) return fecharMencao();
  const termo = m[2].toLowerCase();
  const opcoes = usuariosAtivos().filter(u =>
    String(u.Apelido).toLowerCase().startsWith(termo) ||
    String(u.Nome).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(termo)
  ).slice(0, 8);
  if (!opcoes.length) return fecharMencao();

  Object.assign(mencao, { campo, inicio: ate.length - m[2].length - 1, opcoes, ativo: 0 });
  const lista = $("#mencaoLista");
  lista.innerHTML = opcoes.map((u, i) =>
    `<li role="option" data-i="${i}" class="${i === 0 ? "ativo" : ""}"><strong>@${esc(u.Apelido)}</strong><small>${esc(u.Nome)}</small></li>`).join("");
  const r = campo.getBoundingClientRect();
  lista.style.left = `${r.left}px`;
  lista.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 230)}px`;
  lista.hidden = false;
}

function fecharMencao() {
  $("#mencaoLista").hidden = true;
  mencao.campo = null;
}

function escolherMencao(i) {
  const { campo, inicio, opcoes } = mencao;
  if (!campo || !opcoes[i]) return;
  const antes = campo.value.slice(0, inicio);
  const depois = campo.value.slice(campo.selectionStart);
  const inserido = `@${opcoes[i].Apelido} `;
  campo.value = antes + inserido + depois;
  const pos = antes.length + inserido.length;
  campo.setSelectionRange(pos, pos);
  campo.focus();
  fecharMencao();
}

function marcarOpcaoMencao(i) {
  mencao.ativo = (i + mencao.opcoes.length) % mencao.opcoes.length;
  document.querySelectorAll("#mencaoLista li").forEach((li, k) => li.classList.toggle("ativo", k === mencao.ativo));
}

document.addEventListener("input", ev => {
  if (ev.target.classList.contains("campo-mencao")) atualizarMencao(ev.target);
});
document.addEventListener("keydown", ev => {
  if (!mencao.campo || $("#mencaoLista").hidden || ev.target !== mencao.campo) return;
  if (ev.key === "ArrowDown") { ev.preventDefault(); marcarOpcaoMencao(mencao.ativo + 1); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); marcarOpcaoMencao(mencao.ativo - 1); }
  else if (ev.key === "Enter" || ev.key === "Tab") { ev.preventDefault(); escolherMencao(mencao.ativo); }
  else if (ev.key === "Escape") fecharMencao();
});
$("#mencaoLista").addEventListener("mousedown", ev => {
  const li = ev.target.closest("li");
  if (li) { ev.preventDefault(); escolherMencao(Number(li.dataset.i)); }
});
document.addEventListener("click", ev => {
  if (!ev.target.closest("#mencaoLista") && !ev.target.classList.contains("campo-mencao")) fecharMencao();
});
window.addEventListener("scroll", fecharMencao, true);

/* ---------------------------------------------------------- */
/* Eventos                                                     */
/* ---------------------------------------------------------- */

$("#btnCitacoes").addEventListener("click", () => { renderizarCitacoes(); $("#modalCitacoes").showModal(); });
$("#btnFecharCitacoes").addEventListener("click", () => $("#modalCitacoes").close());
$("#filtroCitacoes").addEventListener("click", ev => {
  const chip = ev.target.closest("[data-fcit]");
  if (chip) { estado.filtroCitacoes = chip.dataset.fcit; renderizarCitacoes(); }
});
$("#listaCitacoes").addEventListener("click", async ev => {
  const ver = ev.target.closest("[data-cit-ver]");
  if (ver) { ev.preventDefault(); return irParaCitacao(ver.dataset.citVer, "discussao"); }
  const enc = ev.target.closest("[data-cit-enc]");
  if (enc) return irParaCitacao(enc.dataset.citEnc, "encaminhamentos");
  const res = ev.target.closest("[data-cit-resolver]");
  if (res) await gravar("ATUALIZAR_CITACAO", { idCitacao: res.dataset.citResolver, status: "Resolvida" });
});

$("#btnUsuarios").addEventListener("click", () => { renderizarUsuarios(); $("#modalUsuarios").showModal(); $("#uNome").focus(); });
$("#btnFecharUsuarios").addEventListener("click", () => $("#modalUsuarios").close());
$("#btnFecharRelatorio").addEventListener("click", () => $("#modalRelatorio").close());
$("#btnRelatorioGrupo").addEventListener("click", gerarRelatorioGrupo);
$("#btnImprimirRelatorio").addEventListener("click", imprimirRelatorio);
$("#btnRelatorioAba").addEventListener("click", abrirRelatorioEmAba);
$("#btnRecomendacoes").addEventListener("click", () => abrirRecomendacoes());
$("#btnRecomendacoesGrupo").addEventListener("click", () => abrirRecomendacoes(estado.grupo));
$("#btnFecharRecomendacoes").addEventListener("click", () => $("#modalRecomendacoes").close());
$("#formRecomendacao").addEventListener("submit", salvarRecomendacao);
$("#btnCancelarEdicaoRec").addEventListener("click", limparFormRecomendacao);
$("#listaRecomendacoes").addEventListener("click", ev => {
  const linha = ev.target.closest("[data-rec]");
  if (!linha) return;
  const idRecomendacao = linha.dataset.rec;
  if (ev.target.closest("[data-rec-editar]")) return editarRecomendacao(idRecomendacao);
  const toggle = ev.target.closest("[data-rec-toggle]");
  if (toggle) return gravar("EDITAR_RECOMENDACAO", { idRecomendacao, ativo: toggle.dataset.ativo !== "1" });
  if (ev.target.closest("[data-rec-excluir]")) {
    const rec = (estado.dados.recomendacoes || []).find(x => x.ID_Recomendacao === idRecomendacao) || {};
    return (async () => {
      const senha = await pedirSenhaExclusao(`Excluir o metadado "${rec.Titulo || ""}"?\n\nEsta ação não pode ser desfeita.`);
      if (senha === null) return;
      const r = await gravar("EXCLUIR_RECOMENDACAO", { idRecomendacao, senha });
      if (r && $("#rId").value === idRecomendacao) limparFormRecomendacao();
    })();
  }
});
$("#formUsuario").addEventListener("submit", salvarUsuario);
$("#uNome").addEventListener("input", ev => { if (!apelidoEditado) $("#uApelido").value = gerarApelido(ev.target.value); });
$("#uApelido").addEventListener("input", ev => { apelidoEditado = ev.target.value !== ""; });
$("#listaUsuarios").addEventListener("click", async ev => {
  const linha = ev.target.closest("[data-usr]");
  if (!linha) return;
  const idUsuario = linha.dataset.usr;
  const toggle = ev.target.closest("[data-usr-toggle]");
  if (toggle) return gravar("EDITAR_USUARIO", { idUsuario, ativo: toggle.dataset.ativo !== "1" });
  if (ev.target.closest("[data-usr-senha]")) {
    const box = $(".redefinir", linha);
    box.hidden = !box.hidden;
    if (!box.hidden) $("input", box).focus();
    return;
  }
  if (ev.target.closest("[data-usr-salvar-senha]")) {
    await gravar("EDITAR_USUARIO", { idUsuario, novaSenha: $(".redefinir input", linha).value });
  }
});
$("#listaUsuarios").addEventListener("change", ev => {
  const sel = ev.target.closest("[data-usr-perfil]");
  if (sel) gravar("EDITAR_USUARIO", { idUsuario: sel.closest("[data-usr]").dataset.usr, perfil: sel.value });
});

$("#formLogin").addEventListener("submit", async ev => {
  ev.preventDefault();
  const senha = $("#senhaInput").value;
  if (!senha) return;
  const erro = await entrar($("#usuarioInput").value.trim(), senha);
  $("#erroLogin").hidden = !erro;
  $("#erroLogin").textContent = erro || "";
  if (erro) $("#senhaInput").select();
});

$("#btnSenha").addEventListener("click", () => {
  $("#formSenha").reset();
  $("#erroSenha").hidden = true;
  $("#modalSenha").showModal();
  $("#sAtual").focus();
});
$("#btnCancelarSenha").addEventListener("click", () => $("#modalSenha").close());
$("#formSenha").addEventListener("submit", async ev => {
  ev.preventDefault();
  const nova = $("#sNova").value;
  if (nova !== $("#sConfirma").value) {
    $("#erroSenha").textContent = "A confirmação não confere com a nova senha.";
    $("#erroSenha").hidden = false;
    return;
  }
  const r = await api("ALTERAR_SENHA", { senhaAtual: $("#sAtual").value, novaSenha: nova });
  if (sessaoExpirou(r)) return;
  if (r.status !== "success") {
    $("#erroSenha").textContent = r.message;
    $("#erroSenha").hidden = false;
    return;
  }
  $("#modalSenha").close();
  aviso(r.message);
});

$("#btnSair").addEventListener("click", sair);
$("#listaGrupos").addEventListener("click", ev => {
  const card = ev.target.closest("[data-grupo]");
  if (card) { abrirGrupo(card.dataset.grupo); window.scrollTo(0, 0); }
});
$("#btnVoltarGrupos").addEventListener("click", voltarAosGrupos);
$("#btnNovoGrupo").addEventListener("click", () => abrirModalGrupo());
$("#btnEditarGrupo").addEventListener("click", () => abrirModalGrupo(grupoAtual()));
$("#btnCancelarGrupo").addEventListener("click", () => $("#modalGrupo").close());
$("#btnAtivarGrupo").addEventListener("click", alternarGrupoAtivo);
$("#formGrupo").addEventListener("submit", salvarGrupo);
$("#btnAtualizar").addEventListener("click", () => carregar());
$("#busca").addEventListener("input", renderizarLista);
$("#filtroStatus").addEventListener("change", renderizarLista);
$("#btnNovaPauta").addEventListener("click", () => abrirModalPauta());
$("#btnCancelarPauta").addEventListener("click", () => $("#modalPauta").close());
$("#formPauta").addEventListener("submit", salvarPauta);

$("#btnIaPautas").addEventListener("click", () => { renderizarSugestoesPautas(); $("#modalIa").showModal(); });
$("#btnFecharIa").addEventListener("click", () => $("#modalIa").close());
$("#formIa").addEventListener("submit", gerarSugestoesPautas);
$("#iaResultado").addEventListener("click", ev => {
  const b = ev.target.closest("[data-adotar-pauta]");
  if (b) adotarPauta(Number(b.dataset.adotarPauta));
});

$("#listaPautas").addEventListener("click", ev => {
  const card = ev.target.closest(".pauta");
  if (!card) return;
  estado.filtroTipo = "";
  estado.citacaoOrigem = null;
  selecionarPauta(card.dataset.id);
  if (window.innerWidth <= 900) $("#detalhe").scrollIntoView({ behavior: "smooth" });
});

const detalhe = $("#detalhe");

detalhe.addEventListener("click", ev => {
  const abaBtn = ev.target.closest("[data-aba]");
  if (abaBtn) { estado.aba = abaBtn.dataset.aba; return renderizarDetalhe(); }


  if (ev.target.closest("#btnEditarPauta")) {
    // Garante a descrição completa antes de editar (o resumo traz só o começo)
    return (async () => {
      if (!detalheDe(estado.selecionada)) await carregarDetalhe(estado.selecionada);
      abrirModalPauta(ideiaCompleta(estado.selecionada));
    })();
  }
  if (ev.target.closest("#btnIaEnc")) return gerarSugestoesEncaminhamentos();
  if (ev.target.closest("#btnRelatorio")) return gerarRelatorio(estado.selecionada);

  const curtirBtn = ev.target.closest("[data-curtir]");
  if (curtirBtn) return curtirSugestao(curtirBtn.dataset.curtir);

  const excluir = ev.target.closest("[data-excluir]");
  if (excluir) return excluirInteracao(excluir.dataset.excluir);

  const adotar = ev.target.closest("[data-ia-adotar]");
  if (adotar) return adotarEncaminhamento(Number(adotar.dataset.iaAdotar));
});

// "toggle" não borbulha: escuta na captura para lembrar quais sugestões estão abertas
detalhe.addEventListener("toggle", ev => {
  const id = ev.target.dataset && ev.target.dataset.sugestao;
  if (!id) return;
  if (ev.target.open) estado.sugestoesAbertas.add(id); else estado.sugestoesAbertas.delete(id);
}, true);

detalhe.addEventListener("change", ev => {
  if (ev.target.id === "statusPauta") {
    gravar("EDITAR_IDEIA", { idIdeia: estado.selecionada, status: ev.target.value });
  } else if (ev.target.dataset.enc) {
    gravar("ATUALIZAR_ENCAMINHAMENTO", { idEncaminhamento: ev.target.dataset.enc, status: ev.target.value, idIdeia: estado.selecionada });
  }
});

detalhe.addEventListener("submit", async ev => {
  ev.preventDefault();
  const id = estado.selecionada;

  if (ev.target.id === "formInteracao") {
    await gravar("ADD_INTERACAO", { idIdeia: id, texto: $("#iTexto").value });
  } else if (ev.target.classList.contains("form-comentario")) {
    const pai = ev.target.dataset.pai;
    const r = await gravar("ADD_INTERACAO", { idIdeia: id, idPai: pai, texto: $("textarea", ev.target).value });
    if (r) {
      const alvo = document.getElementById("int-" + pai);
      if (alvo) alvo.scrollIntoView({ block: "nearest" });
    }
  } else if (ev.target.id === "formEncaminhamento") {
    const ok = await gravar("ADD_ENCAMINHAMENTO", {
      idIdeia: id,
      acaoTexto: $("#eAcao").value,
      responsavel: $("#eResponsavel").value,
      prazo: $("#ePrazo").value,
      idCitacao: estado.citacaoOrigem || ""
    });
    if (ok && estado.citacaoOrigem) { estado.citacaoOrigem = null; renderizarDetalhe(); }
  } else if (ev.target.id === "formTexto") {
    await gravar("EDITAR_IDEIA", { idIdeia: id, linkDoc: $("#tLink").value.trim() });
  }
});

// Reentra automaticamente se o token da sessão ainda estiver no navegador
(async function iniciar() {
  let salvo = "";
  try { salvo = sessionStorage.getItem(CHAVE_TOKEN) || ""; } catch (e) {}
  if (!salvo) return;
  estado.token = salvo;
  // Com cópia local: mostra na hora e atualiza em segundo plano, sem cobrir a tela
  const copia = lerCopiaLocal(salvo);
  if (copia) {
    estado.detalhes = copia.detalhes || {};
    await abrirApp({ status: "success", ...copia.resposta });
    const erro = await abrirApp(null, true);
    if (erro && estado.token) aviso(erro, true);
    return;
  }
  const erro = await abrirApp();
  if (erro) mostrarLogin(erro);
})();

/* ---------------------------------------------------------- */
/* Modo demonstração (index.html?demo) — simula o Code.gs      */
/* ---------------------------------------------------------- */

const demoBanco = {
  ideias: [
    { ID_Ideia: "IDEIA-1", Data_Criacao: "2026-10-20T13:00:00.000Z", Titulo: "Política de uso de IA generativa", Descricao: "Definir regras para uso de ferramentas de IA pelos servidores, incluindo dados que podem ou não ser enviados.", Status: "Em Debate", Link_Doc_Oficial: "", Autor: "Ana" },
    { ID_Ideia: "IDEIA-2", Data_Criacao: "2026-10-27T13:00:00.000Z", Titulo: "Renovação do parque de notebooks", Descricao: "Levantar a necessidade de substituição dos equipamentos com mais de 5 anos.", Status: "Em Redação", Link_Doc_Oficial: "https://docs.google.com/document/d/EXEMPLO/edit", Autor: "Bruno" },
    { ID_Ideia: "IDEIA-3", ID_Grupo: "GT-COMPRAS", Data_Criacao: "2026-10-29T13:00:00.000Z", Titulo: "Calendário de licitações 2027", Descricao: "Consolidar as demandas de compra das áreas e definir o calendário anual de licitações.", Status: "Em Debate", Link_Doc_Oficial: "", Autor: "Ana Souza" }
  ],
  // IDEIA-1 e IDEIA-2 não têm ID_Grupo (como numa planilha antiga) → GT-Sistemas
  grupos: [
    { ID_Grupo: "GT-SISTEMAS", Nome: "GT-Sistemas", Descricao: "Sistemas, infraestrutura e governança de TI", Ativo: "Sim" },
    { ID_Grupo: "GT-COMPRAS", Nome: "GT-Compras", Descricao: "Planejamento de compras e contratos", Ativo: "Sim" }
  ],
  recomendacoes: [
    { ID_Recomendacao: "REC-1", ID_Grupo: "", Titulo: "Conformidade com a LGPD", Texto: "Aponte riscos de tratamento de dados pessoais e sugira consulta ao DPO quando houver.", Ativo: "Sim" }
  ],
  interacoes: [
    { ID_Interacao: "INT-2", ID_Ideia: "IDEIA-1", ID_Pai: "", Tipo: "Sugestão", Autor: "Bruno", Texto: "Criar uma lista de ferramentas homologadas.", Data: "2026-10-21T10:00:00.000Z" },
    { ID_Interacao: "INT-1", ID_Ideia: "IDEIA-1", ID_Pai: "INT-2", Tipo: "Comentário", Autor: "Carla", Texto: "Precisamos alinhar com a LGPD antes de liberar.", Data: "2026-10-22T14:00:00.000Z" },
    { ID_Interacao: "INT-0", ID_Ideia: "IDEIA-1", ID_Pai: "", Tipo: "Comentário", Autor: "Ana", Texto: "Comentário antigo, de antes das sugestões.", Data: "2026-10-20T14:00:00.000Z" }
  ],
  encaminhamentos: [
    { ID_Encaminhamento: "ENC-1", ID_Ideia: "IDEIA-2", Acao: "Levantar inventário de notebooks por setor", Responsavel: "Bruno", Prazo: "2026-10-30", Status: "Pendente" },
    { ID_Encaminhamento: "ENC-2", ID_Ideia: "IDEIA-1", Acao: "Consultar o encarregado de dados (DPO)", Responsavel: "Carla", Prazo: "2026-11-20", Status: "Em Andamento" }
  ],
  // No demo a senha fica em texto só para simular; o Code.gs guarda hash
  usuarios: [
    { ID_Usuario: "USR-1", Nome: "Marco Nunes", Apelido: "marco.nunes", Email: "", Perfil: "Colaborador", Ativo: "Sim", senha: "123456" },
    { ID_Usuario: "USR-2", Nome: "Ana Souza", Apelido: "ana.souza", Email: "", Perfil: "Colaborador", Ativo: "Sim", senha: "123456" },
    { ID_Usuario: "USR-3", Nome: "Bruno Lima", Apelido: "bruno.lima", Email: "", Perfil: "Leitura", Ativo: "Sim", senha: "123456" }
  ],
  citacoes: [],
  curtidas: [
    { ID_Curtida: "CUR-1", ID_Ideia: "IDEIA-1", ID_Interacao: "INT-2", Apelido: "ana.souza", Nome: "Ana Souza" }
  ]
};
demoBanco.interacoes.push({ ID_Interacao: "INT-3", ID_Ideia: "IDEIA-2", ID_Pai: "", Tipo: "Sugestão", Autor: "Ana Souza", Texto: "@marco.nunes você consegue levantar o orçamento disponível?", Data: "2026-11-01T12:00:00.000Z" });
demoBanco.citacoes.push({ ID_Citacao: "CIT-1", ID_Ideia: "IDEIA-2", ID_Interacao: "INT-3", Apelido: "marco.nunes", Autor: "Ana Souza", Trecho: "@marco.nunes você consegue levantar o orçamento disponível?", Status: "Pendente", Data: "2026-11-01T12:00:00.000Z" });
demoBanco.interacoes.push({ ID_Interacao: "INT-4", ID_Ideia: "IDEIA-3", ID_Pai: "", Tipo: "Sugestão", Autor: "Ana Souza", Texto: "@marco.nunes inclua as renovações de licenças de software no calendário.", Data: "2026-11-02T12:00:00.000Z" });
demoBanco.citacoes.push({ ID_Citacao: "CIT-2", ID_Ideia: "IDEIA-3", ID_Interacao: "INT-4", Apelido: "marco.nunes", Autor: "Ana Souza", Trecho: "@marco.nunes inclua as renovações de licenças de software no calendário.", Status: "Pendente", Data: "2026-11-02T12:00:00.000Z" });

// Sessões do demo sobrevivem ao recarregar a página (como o token real no CacheService)
const demoSessoes = (() => {
  let salvas = {};
  try { salvas = JSON.parse(sessionStorage.getItem("sre_demo_sessoes") || "{}"); } catch (e) {}
  return new Proxy(salvas, {
    set(alvo, k, v) { alvo[k] = v; try { sessionStorage.setItem("sre_demo_sessoes", JSON.stringify(alvo)); } catch (e) {} return true; },
    deleteProperty(alvo, k) { delete alvo[k]; try { sessionStorage.setItem("sre_demo_sessoes", JSON.stringify(alvo)); } catch (e) {} return true; }
  });
})();

const DEMO_NIVEL = { Administrador: "ADMIN", Colaborador: "ESCRITA", Leitura: "LEITURA" };
const DEMO_EXCLUEM = ["marco.nunes"]; // espelha EXCLUEM_INTERACOES do Code.gs
const DEMO_SO_LEITURA = new Set(["LOGIN", "LISTAR", "DETALHE_IDEIA", "SAIR", "ALTERAR_SENHA", "IA_SUGERIR_PAUTAS", "IA_SUGERIR_ENCAMINHAMENTOS"]);

/** Simula o Code.gs: carga parcial (resumo + detalhe) e gravações que já devolvem os dados. */
async function demoApi(req) {
  await new Promise(r => setTimeout(r, 500));
  const r = await demoExecutar(req);
  if (r.status !== "success") return r;
  const sessao = demoSessoes[r.token || req.token];
  if (req.acao === "LOGIN" || req.acao === "LISTAR") return { ...r, ...demoResumo(sessao) };
  if (req.acao === "DETALHE_IDEIA") {
    const detalhe = demoDetalhe(req.idIdeia);
    return detalhe ? { status: "success", detalhe } : { status: "error", message: "Pauta não encontrada." };
  }
  if (!DEMO_SO_LEITURA.has(req.acao)) {
    Object.assign(r, demoResumo(sessao));
    const id = r.id || req.idIdeia;
    if (id) r.detalhe = demoDetalhe(id);
  }
  return r;
}

function demoResumo(sessao) {
  const nivel = sessao.nivel;
  const hoje = hojeISO();
  const copia = JSON.parse(JSON.stringify(demoBanco));
  const ideias = copia.ideias.map(i => {
    const ints = copia.interacoes.filter(x => x.ID_Ideia === i.ID_Ideia);
    const encs = copia.encaminhamentos.filter(x => x.ID_Ideia === i.ID_Ideia);
    const abertos = encs.filter(e => e.Status === "Pendente" || e.Status === "Em Andamento");
    const desc = String(i.Descricao || "");
    return {
      ...i,
      Descricao: desc.slice(0, 300),
      Descricao_Completa: desc.length <= 300,
      Qtd_Sugestoes: ints.filter(x => x.Tipo === "Sugestão" && !x.ID_Pai).length,
      Qtd_Comentarios: ints.filter(x => !(x.Tipo === "Sugestão" && !x.ID_Pai)).length,
      Qtd_Encaminhamentos: encs.length,
      Qtd_Abertos: abertos.length,
      Qtd_Atrasados: abertos.filter(e => String(e.Prazo || "") && String(e.Prazo).slice(0, 10) < hoje).length
    };
  });
  const usuarios = copia.usuarios.map(({ senha, ...u }) => nivel === "ADMIN" ? { ...u, Tem_Senha: !!senha } : { ID_Usuario: u.ID_Usuario, Nome: u.Nome, Apelido: u.Apelido, Ativo: u.Ativo });
  const meu = sessao.apelido && sessao.apelido !== "admin" ? sessao.apelido : "";
  return {
    nivelAcesso: nivel,
    usuario: { nome: sessao.nome, apelido: sessao.apelido, nivel, podeExcluirInteracoes: DEMO_EXCLUEM.includes(sessao.apelido) },
    hoje,
    dados: {
      ideias: ideias.map(i => ({ ...i, ID_Grupo: grupoDe(i) })),
      grupos: copia.grupos.filter(g => nivel === "ADMIN" || grupoAtivo(g)),
      usuarios,
      citacoes: meu ? copia.citacoes.filter(c => c.Apelido === meu) : [],
      recomendacoes: nivel === "ADMIN" ? copia.recomendacoes : []
    },
    listas: { PERFIS: Object.keys(DEMO_NIVEL) }
  };
}

function demoDetalhe(id) {
  const copia = JSON.parse(JSON.stringify(demoBanco));
  const ideia = copia.ideias.find(i => i.ID_Ideia === String(id));
  if (!ideia) return null;
  return {
    idIdeia: ideia.ID_Ideia,
    ideia,
    interacoes: copia.interacoes.filter(x => x.ID_Ideia === ideia.ID_Ideia),
    curtidas: copia.curtidas.filter(x => x.ID_Ideia === ideia.ID_Ideia),
    encaminhamentos: copia.encaminhamentos.filter(x => x.ID_Ideia === ideia.ID_Ideia)
  };
}

async function demoExecutar(req) {
  const NIVEL = DEMO_NIVEL;

  if (req.acao === "LOGIN") {
    const ap = String(req.usuario || "").replace(/^@/, "").toLowerCase();
    let s = null;
    if (!ap && req.senha === "demo-ver") s = { apelido: "", nome: "Observador", nivel: "LEITURA" };
    else if (ap === "admin" && req.senha === "demo-admin") s ={ apelido: "admin", nome: "Administrador", nivel: "ADMIN" };
    else {
      const u = demoBanco.usuarios.find(x => x.Apelido === ap && x.Ativo === "Sim" && x.senha === req.senha);
      if (u) s = { apelido: u.Apelido, nome: u.Nome, nivel: NIVEL[u.Perfil] };
    }
    if (!s) return { status: "error", message: ap ? "Usuário ou senha inválidos." : "Senha de observador inválida." };
    const token = "demo-" + crypto.randomUUID();
    demoSessoes[token] = s;
    return { status: "success", token, usuario: s };
  }

  const sessao = demoSessoes[req.token];
  if (!sessao) return { status: "error", codigo: "SESSAO", message: "Sua sessão expirou. Entre novamente." };
  if (sessao.apelido && sessao.apelido !== "admin") {
    const u = demoBanco.usuarios.find(x => x.Apelido === sessao.apelido);
    if (!u || u.Ativo !== "Sim") { delete demoSessoes[req.token]; return { status: "error", codigo: "SESSAO", message: "Sua sessão expirou. Entre novamente." }; }
    sessao.nivel = NIVEL[u.Perfil];
  }
  const nivel = sessao.nivel;
  req.autor = sessao.nome;
  const agora = new Date().toISOString();
  const ok = message => ({ status: "success", message });
  const ideia = () => demoBanco.ideias.find(i => i.ID_Ideia === req.idIdeia);
  const usr = () => demoBanco.usuarios.find(u => u.ID_Usuario === req.idUsuario);

  if (req.acao === "SAIR") { delete demoSessoes[req.token]; return ok(""); }
  if (req.acao === "LISTAR" || req.acao === "DETALHE_IDEIA") return { status: "success" };
  if (req.acao === "ALTERAR_SENHA") {
    const u = demoBanco.usuarios.find(x => x.Apelido === sessao.apelido);
    if (!u) return { status: "error", message: "O acesso de observador/admin não tem senha própria." };
    if (u.senha !== req.senhaAtual) return { status: "error", message: "Senha atual incorreta." };
    if (String(req.novaSenha).length < 6) return { status: "error", message: "A senha deve ter pelo menos 6 caracteres." };
    u.senha = req.novaSenha;
    return ok("Senha alterada!");
  }
  // No demo a senha da IA é "demo-ia"; a real fica só na propriedade SENHA_IA do Code.gs
  if (/^IA_/.test(req.acao) && nivel !== "LEITURA" && req.senhaIA !== "demo-ia") {
    return { status: "error", codigo: "SENHA_IA", message: req.senhaIA ? "Senha da IA incorreta." : "Digite a senha da IA." };
  }
  if (/^EXCLUIR_/.test(req.acao)) {
    if (!req.senha) return { status: "error", message: "Digite a sua senha para confirmar a exclusão." };
    const u = demoBanco.usuarios.find(x => x.Apelido === sessao.apelido);
    const senhaOk = sessao.apelido === "admin" ? req.senha === "demo-admin" : !!u && u.senha === req.senha;
    if (!senhaOk) return { status: "error", message: "Senha incorreta. A exclusão não foi feita." };
    if (req.acao === "EXCLUIR_INTERACAO" && !DEMO_EXCLUEM.includes(sessao.apelido)) return { status: "error", message: "Você não tem permissão para excluir sugestões e comentários." };
  }
  const interacaoAberta = req.acao === "CURTIR" || (req.acao === "ADD_INTERACAO" && req.idPai) || req.acao === "EXCLUIR_INTERACAO";
  if (interacaoAberta && !sessao.apelido) return { status: "error", message: "Entre com o seu usuário para curtir ou comentar." };
  if (nivel === "LEITURA" && !interacaoAberta) return { status: "error", message: "Seu perfil é somente leitura." };
  if (/^(CRIAR|EDITAR)_USUARIO$/.test(req.acao) && nivel !== "ADMIN") return { status: "error", message: "Apenas administradores gerenciam usuários." };

  switch (req.acao) {
    case "CRIAR_IDEIA": {
      const id = "IDEIA-" + Date.now();
      const g = demoBanco.grupos.find(x => x.ID_Grupo === (req.idGrupo || GRUPO_PADRAO.ID_Grupo));
      if (!g || !grupoAtivo(g)) return { status: "error", message: "Grupo de trabalho não encontrado ou desativado." };
      demoBanco.ideias.push({ ID_Ideia: id, ID_Grupo: g.ID_Grupo, Data_Criacao: agora, Titulo: req.titulo, Descricao: req.descricao, Status: "Em Debate", Link_Doc_Oficial: req.linkDoc || "", Autor: req.autor });
      return { ...ok("Pauta cadastrada!"), id };
    }
    case "EDITAR_IDEIA": {
      const i = ideia();
      if (req.titulo !== undefined) i.Titulo = req.titulo;
      if (req.descricao !== undefined) i.Descricao = req.descricao;
      if (req.status !== undefined) i.Status = req.status;
      if (req.linkDoc !== undefined) i.Link_Doc_Oficial = req.linkDoc;
      return ok("Pauta atualizada!");
    }
    case "ADD_INTERACAO": {
      const idInt = "INT-" + Date.now();
      const pai = req.idPai ? demoBanco.interacoes.find(i => i.ID_Interacao === req.idPai && i.Tipo === "Sugestão") : null;
      if (req.idPai && !pai) return { status: "error", message: "Sugestão não encontrada." };
      req.tipo = pai ? "Comentário" : "Sugestão";
      demoBanco.interacoes.push({ ID_Interacao: idInt, ID_Ideia: req.idIdeia, ID_Pai: pai ? pai.ID_Interacao : "", Tipo: req.tipo, Autor: req.autor, Texto: req.texto, Data: agora });
      const citados = [...new Set([...req.texto.matchAll(/@([a-z0-9._-]+)/gi)].map(m => m[1].toLowerCase().replace(/[.\-_]+$/, "")))]
        .filter(ap => demoBanco.usuarios.some(u => u.Apelido === ap && u.Ativo === "Sim"));
      citados.forEach((ap, i) => demoBanco.citacoes.push({ ID_Citacao: `CIT-${Date.now()}-${i}`, ID_Ideia: req.idIdeia, ID_Interacao: idInt, Apelido: ap, Autor: req.autor, Trecho: req.texto, Status: "Pendente", Data: agora }));
      return ok((pai ? "Comentário registrado!" : "Sugestão registrada!") + (citados.length ? " " + citados.map(a => "@" + a).join(", ") + " notificado(s)." : ""));
    }
    case "ADD_ENCAMINHAMENTO":
      demoBanco.encaminhamentos.push({ ID_Encaminhamento: "ENC-" + Date.now(), ID_Ideia: req.idIdeia, Acao: req.acaoTexto, Responsavel: req.responsavel, Prazo: req.prazo, Status: "Pendente" });
      if (req.idCitacao) demoBanco.citacoes.find(c => c.ID_Citacao === req.idCitacao).Status = "Encaminhada";
      return ok("Encaminhamento registrado!");
    case "CRIAR_GRUPO": case "EDITAR_GRUPO": {
      if (nivel !== "ADMIN") return { status: "error", message: "Apenas administradores gerenciam os grupos de trabalho." };
      const nome = String(req.nome ?? "").trim();
      const mesmoNome = x => String(x.Nome).toLowerCase() === nome.toLowerCase();
      if (req.acao === "CRIAR_GRUPO") {
        if (!nome) return { status: "error", message: "Informe o nome do grupo de trabalho." };
        if (demoBanco.grupos.some(mesmoNome)) return { status: "error", message: `Já existe um grupo de trabalho chamado "${nome}".` };
        const idGrupo = "GT-" + Date.now();
        demoBanco.grupos.push({ ID_Grupo: idGrupo, Nome: nome, Descricao: req.descricao || "", Ativo: "Sim" });
        return { ...ok(`Grupo "${nome}" criado!`), idGrupo };
      }
      const g = demoBanco.grupos.find(x => x.ID_Grupo === req.idGrupo);
      if (!g) return { status: "error", message: "Grupo de trabalho não encontrado." };
      if (req.nome !== undefined) {
        if (!nome) return { status: "error", message: "O nome não pode ficar vazio." };
        if (demoBanco.grupos.some(x => x !== g && mesmoNome(x))) return { status: "error", message: "Já existe um grupo de trabalho com esse nome." };
        g.Nome = nome;
      }
      if (req.descricao !== undefined) g.Descricao = req.descricao;
      if (req.ativo !== undefined) g.Ativo = req.ativo ? "Sim" : "Não";
      return ok(req.ativo === false ? "Grupo desativado." : req.ativo === true ? "Grupo reativado." : "Grupo atualizado!");
    }
    case "CURTIR": {
      const s = demoBanco.interacoes.find(i => i.ID_Interacao === req.idInteracao && i.ID_Ideia === req.idIdeia && i.Tipo === "Sugestão" && !i.ID_Pai);
      if (!s) return { status: "error", message: "Sugestão não encontrada." };
      const eu = sessao.apelido.toLowerCase();
      const minha = c => c.ID_Interacao === s.ID_Interacao && c.Apelido === eu;
      if (demoBanco.curtidas.some(minha)) {
        demoBanco.curtidas = demoBanco.curtidas.filter(c => !minha(c));
        return { ...ok("Curtida removida."), curtiu: false };
      }
      demoBanco.curtidas.push({ ID_Curtida: "CUR-" + Date.now(), ID_Ideia: req.idIdeia, ID_Interacao: s.ID_Interacao, Apelido: eu, Nome: sessao.nome });
      return { ...ok("Sugestão curtida!"), curtiu: true };
    }
    case "CRIAR_RECOMENDACAO": case "EDITAR_RECOMENDACAO": case "EXCLUIR_RECOMENDACAO": {
      if (nivel !== "ADMIN") return { status: "error", message: "Apenas administradores gerenciam os metadados da IA." };
      const rec = demoBanco.recomendacoes.find(x => x.ID_Recomendacao === req.idRecomendacao);
      if (req.acao !== "CRIAR_RECOMENDACAO" && !rec) return { status: "error", message: "Metadado não encontrado." };
      if (req.acao === "EXCLUIR_RECOMENDACAO") {
        demoBanco.recomendacoes = demoBanco.recomendacoes.filter(x => x !== rec);
        return ok("Metadado excluído.");
      }
      if (req.ativo !== undefined) {
        rec.Ativo = req.ativo ? "Sim" : "Não";
        return ok(req.ativo ? "Metadado reativado." : "Metadado desativado.");
      }
      const titulo = String(req.titulo || "").trim(), texto = String(req.texto || "").trim();
      if (!titulo || !texto) return { status: "error", message: "Informe o título e o texto do metadado." };
      if (rec) { Object.assign(rec, { Titulo: titulo, Texto: texto, ID_Grupo: req.idGrupo || "" }); return ok("Metadado atualizado!"); }
      demoBanco.recomendacoes.push({ ID_Recomendacao: "REC-" + Date.now(), ID_Grupo: req.idGrupo || "", Titulo: titulo, Texto: texto, Ativo: "Sim", Autor: req.autor });
      return ok("Metadado cadastrado!");
    }
    case "EXCLUIR_INTERACAO": {
      const alvo = demoBanco.interacoes.find(i => i.ID_Interacao === req.idInteracao);
      if (!alvo) return { status: "error", message: "Registro não encontrado. Ele pode já ter sido excluído." };
      const ids = [alvo.ID_Interacao, ...(alvo.Tipo === "Sugestão" ? demoBanco.interacoes.filter(i => i.ID_Pai === alvo.ID_Interacao).map(i => i.ID_Interacao) : [])];
      demoBanco.interacoes = demoBanco.interacoes.filter(i => !ids.includes(i.ID_Interacao));
      demoBanco.citacoes = demoBanco.citacoes.filter(c => !ids.includes(c.ID_Interacao));
      demoBanco.curtidas = demoBanco.curtidas.filter(c => !ids.includes(c.ID_Interacao));
      return ok(alvo.Tipo === "Sugestão" ? `Sugestão excluída${ids.length > 1 ? ` com ${ids.length - 1} comentário(s).` : "."}` : "Comentário excluído.");
    }
    case "CRIAR_USUARIO": {
      const apelido = (req.apelido || gerarApelido(req.nome)).toLowerCase();
      if (demoBanco.usuarios.some(u => u.Apelido === apelido)) return { status: "error", message: `Já existe um usuário com o apelido @${apelido}.` };
      if (String(req.senha || "").length < 6) return { status: "error", message: "A senha deve ter pelo menos 6 caracteres." };
      demoBanco.usuarios.push({ ID_Usuario: "USR-" + Date.now(), Nome: req.nome, Apelido: apelido, Email: req.email, Perfil: req.perfil || "Colaborador", Ativo: "Sim", senha: req.senha });
      return ok(`Usuário @${apelido} cadastrado!`);
    }
    case "EDITAR_USUARIO": {
      const u = usr();
      if (req.ativo !== undefined) u.Ativo = req.ativo ? "Sim" : "Não";
      if (req.perfil !== undefined) u.Perfil = req.perfil;
      if (req.novaSenha !== undefined) {
        if (String(req.novaSenha).length < 6) return { status: "error", message: "A senha deve ter pelo menos 6 caracteres." };
        u.senha = req.novaSenha;
        return ok("Senha redefinida!");
      }
      return ok("Usuário atualizado!");
    }
    case "ATUALIZAR_CITACAO":
      demoBanco.citacoes.find(c => c.ID_Citacao === req.idCitacao).Status = req.status;
      return ok("Citação marcada como " + req.status.toLowerCase() + ".");
    case "ATUALIZAR_ENCAMINHAMENTO":
      demoBanco.encaminhamentos.find(e => e.ID_Encaminhamento === req.idEncaminhamento).Status = req.status;
      return ok("Encaminhamento atualizado!");
    case "IA_SUGERIR_PAUTAS":
      return { status: "success", ia: { provedor: "Demonstração", modelo: "", segundos: 0 }, sugestoes: [
        { titulo: "Plano de continuidade de TI", descricao: "Definir procedimentos para indisponibilidade de sistemas críticos e responsáveis por cada etapa.", justificativa: "Nenhuma pauta trata de contingência." },
        { titulo: "Capacitação em segurança da informação", descricao: "Programa de treinamento anual para servidores sobre phishing e boas práticas.", justificativa: "Complementa a política de uso de IA." }
      ] };
    case "IA_SUGERIR_ENCAMINHAMENTOS":
      return { status: "success", ia: { provedor: "Demonstração", modelo: "", segundos: 0 }, recomendacoesAplicadas: demoBanco.recomendacoes.filter(x => grupoAtivo(x) && (!x.ID_Grupo || x.ID_Grupo === grupoDe(ideia() || {}))).length, sintese: "O grupo concorda que é preciso alinhar o tema com a LGPD e sugere uma lista de ferramentas homologadas.", encaminhamentos: [
        { acao: "Elaborar minuta da lista de ferramentas de IA homologadas", responsavel: "Bruno", prazoDias: 15 },
        { acao: "Redigir a primeira versão da política no Google Docs", responsavel: "", prazoDias: 30 }
      ] };
  }
  return { status: "error", message: "Ação desconhecida." };
}
