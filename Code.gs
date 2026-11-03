/**
 * Sistema de Reuniões e Encaminhamentos — Backend (Google Apps Script)
 *
 * Acesso:
 *   Cada usuário entra com @apelido + senha própria (cadastrada na aba
 *   Usuarios_GT, guardada como hash com salt). Perfis do cadastro:
 *     Administrador → tudo, inclusive cadastrar usuários e redefinir senhas
 *     Colaborador   → cria pautas, comenta, sugere, encaminha e edita
 *     Leitura       → só acompanha
 *   Primeiro acesso: usuário "admin" com a senha SENHA_ADMIN.
 *   Observador sem cadastro: usuário em branco + SENHA_LEITURA (opcional;
 *   deixe a propriedade vazia para desativar).
 *
 * Propriedades do script: SENHA_ADMIN, SENHA_LEITURA, GEMINI_API_KEY...
 * O login devolve um token de sessão (6 h); a senha não é reenviada.
 * Toda comunicação é via POST (Content-Type text/plain).
 */

// Sem senhas no código: SENHA_ADMIN e SENHA_LEITURA vêm só das Propriedades do script.
// configurar() gera uma SENHA_ADMIN aleatória se ainda não houver nenhuma.
const SESSAO_SEGUNDOS = 6 * 60 * 60;
const MAX_TENTATIVAS = 5;
const BLOQUEIO_SEGUNDOS = 10 * 60;
const PERFIS = { "Administrador": "ADMIN", "Colaborador": "ESCRITA", "Leitura": "LEITURA" };

const ABAS = {
  ideias: {
    nome: "Ideias_GT",
    colunas: ["ID_Ideia", "Data_Criacao", "Titulo", "Descricao", "Status",
              "Link_Doc_Oficial", "Autor", "Atualizado_Em"],
    // Outros nomes aceitos no cabeçalho (sem acento, minúsculo, só letras/números)
    apelidos: {
      ID_Ideia: ["id", "codigo"],
      Data_Criacao: ["data", "datacadastro", "criadoem", "datahora", "timestamp"],
      Titulo: ["assunto", "tema", "pauta", "ideia"],
      Descricao: ["contexto", "detalhes", "descricaocontexto"],
      Link_Doc_Oficial: ["link", "linkdoc", "documento", "docoficial", "textooficial", "linkdocumento", "linkdocs"]
    }
  },
  interacoes: {
    nome: "Interacoes_GT",
    colunas: ["ID_Interacao", "ID_Ideia", "ID_Pai", "Tipo", "Autor", "Texto", "Data"],
    apelidos: {
      ID_Interacao: ["id", "codigo"],
      ID_Ideia: ["ideia", "idpauta"],
      ID_Pai: ["idsugestao", "sugestaopai", "pai"],
      Texto: ["comentario", "mensagem", "conteudo", "sugestao"],
      Data: ["datahora", "criadoem", "timestamp"]
    }
  },
  encaminhamentos: {
    nome: "Encaminhamentos_GT",
    colunas: ["ID_Encaminhamento", "ID_Ideia", "Acao", "Responsavel", "Prazo",
              "Status", "Data_Criacao", "Atualizado_Em"],
    apelidos: {
      ID_Encaminhamento: ["id", "codigo"],
      ID_Ideia: ["ideia", "idpauta"],
      Acao: ["acaotexto", "encaminhamento", "descricao", "tarefa"],
      Data_Criacao: ["data", "criadoem", "timestamp"]
    }
  },
  usuarios: {
    nome: "Usuarios_GT",
    colunas: ["ID_Usuario", "Nome", "Apelido", "Email", "Perfil", "Ativo", "Senha_Hash", "Data_Criacao"]
  },
  citacoes: {
    nome: "Citacoes_GT",
    colunas: ["ID_Citacao", "ID_Ideia", "ID_Interacao", "Apelido", "Autor", "Trecho",
              "Status", "Data", "Atualizado_Em"]
  }
};

const STATUS_IDEIA = ["Em Debate", "Em Redação", "Aprovada", "Arquivada"];
const TIPOS_INTERACAO = ["Comentário", "Sugestão"];
const STATUS_ENCAMINHAMENTO = ["Pendente", "Em Andamento", "Concluído", "Cancelado"];
const STATUS_CITACAO = ["Pendente", "Encaminhada", "Resolvida"];

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

function doGet() {
  return respostaJSON({ status: "success", message: "API do Sistema de Reuniões e Encaminhamentos ativa." });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const acao = req.acao || "LISTAR";

    if (acao === "LOGIN") return login(req);

    const sessao = sessaoDoToken(req.token);
    if (!sessao) return respostaJSON({ status: "error", codigo: "SESSAO", message: "Sua sessão expirou. Entre novamente." });

    if (acao === "SAIR") {
      CacheService.getScriptCache().remove("sess_" + req.token);
      return respostaJSON({ status: "success" });
    }
    if (acao === "LISTAR") return listar(sessao);
    if (acao === "DETALHE_IDEIA") return detalheIdeia(req);
    if (acao === "ALTERAR_SENHA") return comLock(function () { return alterarSenha(req, sessao); });

    // Daqui para baixo, apenas colaborador ou administrador
    if (sessao.nivel === "LEITURA") return erro("Seu perfil é somente leitura.");

    // O autor é sempre quem está logado — não vem do navegador
    req.autor = sessao.nome;

    // IA não grava nada, então dispensa o lock
    if (acao === "IA_SUGERIR_PAUTAS") return iaSugerirPautas(req);
    if (acao === "IA_SUGERIR_ENCAMINHAMENTOS") return iaSugerirEncaminhamentos(req);

    const handlers = {
      CRIAR_IDEIA: criarIdeia,
      EDITAR_IDEIA: editarIdeia,
      ADD_INTERACAO: addInteracao,
      ADD_ENCAMINHAMENTO: addEncaminhamento,
      ATUALIZAR_ENCAMINHAMENTO: atualizarEncaminhamento,
      ATUALIZAR_CITACAO: atualizarCitacao,
      CRIAR_USUARIO: criarUsuario,
      EDITAR_USUARIO: editarUsuario,
      EXCLUIR_INTERACAO: excluirInteracao
    };
    const handler = handlers[acao];
    if (!handler) return erro("Ação desconhecida: " + acao);
    if ((acao === "CRIAR_USUARIO" || acao === "EDITAR_USUARIO") && sessao.nivel !== "ADMIN") {
      return erro("Apenas administradores gerenciam usuários.");
    }
    if (acao === "EXCLUIR_INTERACAO" && sessao.nivel !== "ADMIN") {
      return erro("Apenas administradores podem excluir sugestões e comentários.");
    }
    const saida = comLock(function () { return handler(req, sessao); });
    return comDadosAtualizados(saida, req, sessao);
  } catch (err) {
    return erro("Erro no servidor: " + err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

function comLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function listar(sessao) {
  return respostaJSON(Object.assign({ status: "success" }, montarResumo(sessao)));
}

const LIMITE_DESCRICAO_RESUMO = 300;

/**
 * Carga inicial leve: pautas com contadores (sem as sugestões, comentários e
 * encaminhamentos em si), usuários e as citações de quem está logado.
 * O conteúdo de cada pauta vem sob demanda em montarDetalhe().
 */
function montarResumo(sessao) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nivel = sessao.nivel;
  const hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  const cont = {};
  const de = function (id) {
    return cont[id] || (cont[id] = { sug: 0, com: 0, enc: 0, abertos: 0, atrasados: 0 });
  };
  lerAba(ss, ABAS.interacoes).forEach(function (i) {
    const c = de(String(i.ID_Ideia));
    if (i.Tipo === "Sugestão" && !i.ID_Pai) c.sug++; else c.com++;
  });
  lerAba(ss, ABAS.encaminhamentos).forEach(function (e) {
    const c = de(String(e.ID_Ideia));
    c.enc++;
    if (e.Status === "Pendente" || e.Status === "Em Andamento") {
      c.abertos++;
      const prazo = String(e.Prazo || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(prazo) && prazo < hoje) c.atrasados++;
    }
  });

  const ideias = lerAba(ss, ABAS.ideias).map(function (i) {
    const c = cont[String(i.ID_Ideia)] || { sug: 0, com: 0, enc: 0, abertos: 0, atrasados: 0 };
    const desc = String(i.Descricao || "");
    return Object.assign({}, i, {
      Descricao: desc.slice(0, LIMITE_DESCRICAO_RESUMO),
      Descricao_Completa: desc.length <= LIMITE_DESCRICAO_RESUMO,
      Qtd_Sugestoes: c.sug,
      Qtd_Comentarios: c.com,
      Qtd_Encaminhamentos: c.enc,
      Qtd_Abertos: c.abertos,
      Qtd_Atrasados: c.atrasados
    });
  });

  const meu = String(sessao.apelido || "").toLowerCase();
  const citacoes = meu && meu !== "admin"
    ? lerAba(ss, ABAS.citacoes).filter(function (c) { return String(c.Apelido).toLowerCase() === meu; })
    : [];

  return {
    nivelAcesso: nivel,
    usuario: { nome: sessao.nome, apelido: sessao.apelido, nivel: nivel },
    hoje: hoje,
    dados: {
      ideias: ideias,
      usuarios: lerAba(ss, ABAS.usuarios).map(function (u) {
        // Hash nunca sai do servidor; e-mail e perfil só para administradores
        const pub = { ID_Usuario: u.ID_Usuario, Nome: u.Nome, Apelido: u.Apelido, Ativo: u.Ativo };
        if (nivel === "ADMIN") {
          pub.Email = u.Email;
          pub.Perfil = perfilDe(u);
          pub.Tem_Senha = !!u.Senha_Hash;
        }
        return pub;
      }),
      citacoes: citacoes
    },
    listas: { STATUS_IDEIA, TIPOS_INTERACAO, STATUS_ENCAMINHAMENTO, STATUS_CITACAO, PERFIS: Object.keys(PERFIS) }
  };
}

/** Conteúdo completo de uma pauta: descrição inteira, sugestões/comentários e encaminhamentos. */
function montarDetalhe(idIdeia) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const id = String(idIdeia);
  const ideia = lerAba(ss, ABAS.ideias).filter(function (i) { return String(i.ID_Ideia) === id; })[0];
  if (!ideia) return null;
  return {
    idIdeia: id,
    ideia: ideia,
    interacoes: lerAba(ss, ABAS.interacoes).filter(function (i) { return String(i.ID_Ideia) === id; }),
    encaminhamentos: lerAba(ss, ABAS.encaminhamentos).filter(function (e) { return String(e.ID_Ideia) === id; })
  };
}

function detalheIdeia(req) {
  const detalhe = montarDetalhe(req.idIdeia);
  if (!detalhe) return erro("Pauta não encontrada. Ela pode ter sido removida.");
  return respostaJSON({ status: "success", detalhe: detalhe });
}

/**
 * Junta à resposta de uma gravação o resumo atualizado e o detalhe da pauta
 * envolvida — assim o navegador não precisa fazer uma segunda requisição.
 */
function comDadosAtualizados(saida, req, sessao) {
  const obj = JSON.parse(saida.getContent());
  if (obj.status !== "success") return saida;
  Object.assign(obj, montarResumo(sessao));
  const idIdeia = obj.id || req.idIdeia;
  if (idIdeia) obj.detalhe = montarDetalhe(idIdeia);
  return respostaJSON(obj);
}

function criarIdeia(req) {
  const titulo = texto(req.titulo, 200);
  if (!titulo) return erro("Informe o título da pauta.");
  const link = linkDoc(req.linkDoc);
  if (link === null) return erro("O link do texto oficial deve ser um endereço do Google Docs/Drive.");

  const agora = new Date();
  const id = "IDEIA-" + agora.getTime();
  inserir(ABAS.ideias, {
    ID_Ideia: id,
    Data_Criacao: agora,
    Titulo: titulo,
    Descricao: texto(req.descricao, 5000),
    Status: "Em Debate",
    Link_Doc_Oficial: link,
    Autor: texto(req.autor, 120),
    Atualizado_Em: agora
  });
  return respostaJSON({ status: "success", message: "Pauta cadastrada!", id: id });
}

function editarIdeia(req) {
  const campos = { Atualizado_Em: new Date() };
  if (req.titulo !== undefined) {
    campos.Titulo = texto(req.titulo, 200);
    if (!campos.Titulo) return erro("O título não pode ficar vazio.");
  }
  if (req.descricao !== undefined) campos.Descricao = texto(req.descricao, 5000);
  if (req.status !== undefined) {
    if (STATUS_IDEIA.indexOf(req.status) < 0) return erro("Status inválido.");
    campos.Status = req.status;
  }
  if (req.linkDoc !== undefined) {
    const link = linkDoc(req.linkDoc);
    if (link === null) return erro("O link do texto oficial deve ser um endereço do Google Docs/Drive.");
    campos.Link_Doc_Oficial = link;
  }
  if (!atualizar(ABAS.ideias, "ID_Ideia", req.idIdeia, campos)) return erro("Pauta não encontrada.");
  return respostaJSON({ status: "success", message: "Pauta atualizada!" });
}

function addInteracao(req) {
  if (!existe(ABAS.ideias, "ID_Ideia", req.idIdeia)) return erro("Pauta não encontrada.");
  const autor = texto(req.autor, 120);
  const conteudo = texto(req.texto, 5000);
  if (!autor || !conteudo) return erro("Escreva o texto.");

  // Sem idPai = nova Sugestão na pauta; com idPai = Comentário daquela sugestão
  let tipo = "Sugestão";
  let idPai = "";
  if (req.idPai) {
    const pai = lerAba(SpreadsheetApp.getActiveSpreadsheet(), ABAS.interacoes).filter(function (i) {
      return String(i.ID_Interacao) === String(req.idPai) && String(i.ID_Ideia) === String(req.idIdeia);
    })[0];
    if (!pai || pai.Tipo !== "Sugestão") return erro("Sugestão não encontrada.");
    tipo = "Comentário";
    idPai = String(pai.ID_Interacao);
  }

  const idInteracao = "INT-" + new Date().getTime();
  inserir(ABAS.interacoes, {
    ID_Interacao: idInteracao,
    ID_Ideia: req.idIdeia,
    ID_Pai: idPai,
    Tipo: tipo,
    Autor: autor,
    Texto: conteudo,
    Data: new Date()
  });
  const citados = registrarCitacoes(req.idIdeia, idInteracao, autor, conteudo);
  const extra = citados.length ? " " + citados.map(function (a) { return "@" + a; }).join(", ") + " notificado(s)." : "";
  return respostaJSON({ status: "success", message: (tipo === "Sugestão" ? "Sugestão registrada!" : "Comentário registrado!") + extra });
}

/** Exclui uma sugestão (com seus comentários) ou um comentário, e as citações ligadas. */
function excluirInteracao(req) {
  const todas = lerAba(SpreadsheetApp.getActiveSpreadsheet(), ABAS.interacoes);
  const alvo = todas.filter(function (i) { return String(i.ID_Interacao) === String(req.idInteracao); })[0];
  if (!alvo) return erro("Registro não encontrado. Ele pode já ter sido excluído.");

  const ids = [String(alvo.ID_Interacao)];
  if (alvo.Tipo === "Sugestão") {
    todas.forEach(function (i) { if (String(i.ID_Pai) === ids[0]) ids.push(String(i.ID_Interacao)); });
  }
  excluirLinhas(ABAS.interacoes, "ID_Interacao", ids);
  excluirLinhas(ABAS.citacoes, "ID_Interacao", ids);

  const qtdComentarios = ids.length - 1;
  return respostaJSON({
    status: "success",
    message: alvo.Tipo === "Sugestão"
      ? "Sugestão excluída" + (qtdComentarios ? " com " + qtdComentarios + " comentário(s)." : ".")
      : "Comentário excluído."
  });
}

/** Cria uma citação para cada @apelido de usuário ativo encontrado no texto. */
function registrarCitacoes(idIdeia, idInteracao, autor, conteudo) {
  const usuarios = lerAba(SpreadsheetApp.getActiveSpreadsheet(), ABAS.usuarios)
    .filter(function (u) { return usuarioAtivo(u); });
  const porApelido = {};
  usuarios.forEach(function (u) { porApelido[String(u.Apelido).toLowerCase()] = u; });

  const encontrados = [];
  const re = /@([a-z0-9._-]+)/gi;
  let m;
  while ((m = re.exec(conteudo)) !== null) {
    const apelido = m[1].toLowerCase().replace(/[.\-_]+$/, "");
    if (porApelido[apelido] && encontrados.indexOf(apelido) < 0) encontrados.push(apelido);
  }

  const agora = new Date();
  encontrados.forEach(function (apelido, i) {
    inserir(ABAS.citacoes, {
      ID_Citacao: "CIT-" + agora.getTime() + "-" + i,
      ID_Ideia: idIdeia,
      ID_Interacao: idInteracao,
      Apelido: apelido,
      Autor: autor,
      Trecho: conteudo.slice(0, 500),
      Status: "Pendente",
      Data: agora,
      Atualizado_Em: agora
    });
    notificarPorEmail(porApelido[apelido], autor, idIdeia, conteudo);
  });
  return encontrados;
}

/** Envia e-mail ao citado apenas se NOTIFICAR_EMAIL = "sim" nas Propriedades do script. */
function notificarPorEmail(usuario, autor, idIdeia, conteudo) {
  const props = PropertiesService.getScriptProperties();
  if (String(props.getProperty("NOTIFICAR_EMAIL") || "").toLowerCase() !== "sim") return;
  if (!usuario.Email) return;
  try {
    const ideia = lerAba(SpreadsheetApp.getActiveSpreadsheet(), ABAS.ideias)
      .filter(function (i) { return String(i.ID_Ideia) === String(idIdeia); })[0];
    const link = props.getProperty("URL_SISTEMA") || "";
    MailApp.sendEmail({
      to: usuario.Email,
      subject: "Você foi citado(a) na pauta: " + (ideia ? ideia.Titulo : idIdeia),
      body: autor + " citou você no Sistema de Reuniões e Encaminhamentos:\n\n\"" + conteudo +
            "\"\n\n" + (link ? "Acesse: " + link + "\n\n" : "") + "— GTIC Hemobrás"
    });
  } catch (e) {
    // Falha de e-mail não impede o registro da citação
  }
}

function usuarioAtivo(u) {
  return u.Ativo === true || String(u.Ativo).toLowerCase() === "sim" || String(u.Ativo).toUpperCase() === "TRUE";
}

/** "Marco Aurélio Nunes" → "marco.nunes" */
function gerarApelido(nome) {
  const partes = normalizarTexto(nome).split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  return partes.length === 1 ? partes[0] : partes[0] + "." + partes[partes.length - 1];
}

function normalizarTexto(v) {
  return String(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9.\s_-]/g, "").trim();
}

/* ------------------------------------------------------------------ */
/* Autenticação e sessão                                               */
/* ------------------------------------------------------------------ */

function login(req) {
  const apelido = normalizarTexto(req.usuario || "").replace(/^@/, "").replace(/\s+/g, "");
  const senha = String(req.senha || "");
  if (!senha) return erro("Informe a senha.");

  const cache = CacheService.getScriptCache();
  const chaveFalhas = "falhas_" + (apelido || "_observador");
  const falhas = Number(cache.get(chaveFalhas) || 0);
  if (falhas >= MAX_TENTATIVAS) return erro("Muitas tentativas incorretas. Aguarde 10 minutos e tente novamente.");

  const props = PropertiesService.getScriptProperties();
  let sessao = null;

  if (!apelido) {
    const senhaObs = props.getProperty("SENHA_LEITURA") || ""; // vazia = acesso de observador desligado
    if (senhaObs && senhaObs.toLowerCase() !== "desativado" && senha === senhaObs) {
      sessao = { apelido: "", nome: "Observador", nivel: "LEITURA" };
    }
  } else if (apelido === "admin") {
    const senhaAdmin = props.getProperty("SENHA_ADMIN") || props.getProperty("SENHA_ESCRITA") || "";
    if (senhaAdmin && senha === senhaAdmin) sessao = { apelido: "admin", nome: "Administrador", nivel: "ADMIN" };
  } else {
    const u = buscarUsuario(apelido);
    if (u && usuarioAtivo(u) && conferirSenha(senha, u.Senha_Hash)) {
      sessao = { apelido: String(u.Apelido), nome: String(u.Nome), nivel: PERFIS[perfilDe(u)] };
    }
  }

  if (!sessao) {
    cache.put(chaveFalhas, String(falhas + 1), BLOQUEIO_SEGUNDOS);
    return erro(apelido ? "Usuário ou senha inválidos." : "Senha de observador inválida.");
  }
  cache.remove(chaveFalhas);

  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, "");
  cache.put("sess_" + token, JSON.stringify(sessao), SESSAO_SEGUNDOS);
  // Já devolve os dados da carga inicial: uma requisição a menos no login
  return respostaJSON(Object.assign({ status: "success", token: token }, montarResumo(sessao)));
}

/** Valida o token e revalida o usuário (desativação e troca de perfil valem na hora). */
function sessaoDoToken(token) {
  if (!token || !/^[\w-]{30,100}$/.test(String(token))) return null;
  const cache = CacheService.getScriptCache();
  const bruto = cache.get("sess_" + token);
  if (!bruto) return null;
  const sessao = JSON.parse(bruto);

  if (sessao.apelido && sessao.apelido !== "admin") {
    const u = buscarUsuario(sessao.apelido);
    if (!u || !usuarioAtivo(u)) {
      cache.remove("sess_" + token);
      return null;
    }
    sessao.nome = String(u.Nome);
    sessao.nivel = PERFIS[perfilDe(u)];
  }
  cache.put("sess_" + token, JSON.stringify(sessao), SESSAO_SEGUNDOS); // renova a validade
  return sessao;
}

function buscarUsuario(apelido) {
  return lerAba(SpreadsheetApp.getActiveSpreadsheet(), ABAS.usuarios)
    .filter(function (u) { return String(u.Apelido).toLowerCase() === String(apelido).toLowerCase(); })[0] || null;
}

function perfilDe(u) {
  return PERFIS[u.Perfil] ? u.Perfil : "Colaborador";
}

/** Hash "salt$hex" com SHA-256 iterado (Apps Script não tem bcrypt). */
function gerarHash(senha, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, "");
  let h = salt + ":" + senha;
  for (let i = 0; i < 300; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8)
      .map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
  }
  return salt + "$" + h;
}

function conferirSenha(senha, armazenado) {
  const partes = String(armazenado || "").split("$");
  if (partes.length !== 2 || !partes[0]) return false;
  return gerarHash(senha, partes[0]) === armazenado;
}

function validarSenha(senha) {
  senha = String(senha || "");
  if (senha.length < 6) return "A senha deve ter pelo menos 6 caracteres.";
  if (senha.length > 100) return "Senha muito longa.";
  return "";
}

function alterarSenha(req, sessao) {
  if (!sessao.apelido) return erro("O acesso de observador não tem senha própria.");
  if (sessao.apelido === "admin") return erro("A senha do admin é alterada nas Propriedades do script (SENHA_ADMIN).");
  const u = buscarUsuario(sessao.apelido);
  if (!u || !conferirSenha(String(req.senhaAtual || ""), u.Senha_Hash)) return erro("Senha atual incorreta.");
  const problema = validarSenha(req.novaSenha);
  if (problema) return erro(problema);
  atualizar(ABAS.usuarios, "ID_Usuario", u.ID_Usuario, { Senha_Hash: gerarHash(String(req.novaSenha)) });
  return respostaJSON({ status: "success", message: "Senha alterada!" });
}

/* ------------------------------------------------------------------ */
/* Usuários (somente administrador)                                    */
/* ------------------------------------------------------------------ */

function criarUsuario(req) {
  const nome = texto(req.nome, 120);
  if (!nome) return erro("Informe o nome.");
  const apelido = normalizarTexto(req.apelido || gerarApelido(nome)).replace(/\s+/g, "");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(apelido)) return erro("Apelido inválido. Use letras, números, ponto ou hífen.");
  if (apelido === "admin") return erro("O apelido @admin é reservado.");
  const email = texto(req.email, 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro("E-mail inválido.");
  const perfil = PERFIS[req.perfil] ? req.perfil : "Colaborador";
  const problema = validarSenha(req.senha);
  if (problema) return erro(problema);

  if (buscarUsuario(apelido)) return erro("Já existe um usuário com o apelido @" + apelido + ".");
  inserir(ABAS.usuarios, {
    ID_Usuario: "USR-" + new Date().getTime(),
    Nome: nome,
    Apelido: apelido,
    Email: email,
    Perfil: perfil,
    Ativo: "Sim",
    Senha_Hash: gerarHash(String(req.senha)),
    Data_Criacao: new Date()
  });
  return respostaJSON({ status: "success", message: "Usuário @" + apelido + " cadastrado!" });
}

function editarUsuario(req) {
  const campos = {};
  if (req.nome !== undefined) {
    campos.Nome = texto(req.nome, 120);
    if (!campos.Nome) return erro("O nome não pode ficar vazio.");
  }
  if (req.email !== undefined) {
    campos.Email = texto(req.email, 200);
    if (campos.Email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(campos.Email)) return erro("E-mail inválido.");
  }
  if (req.perfil !== undefined) {
    if (!PERFIS[req.perfil]) return erro("Perfil inválido.");
    campos.Perfil = req.perfil;
  }
  if (req.ativo !== undefined) campos.Ativo = req.ativo ? "Sim" : "Não";
  if (req.novaSenha !== undefined) {
    const problema = validarSenha(req.novaSenha);
    if (problema) return erro(problema);
    campos.Senha_Hash = gerarHash(String(req.novaSenha));
  }
  if (!atualizar(ABAS.usuarios, "ID_Usuario", req.idUsuario, campos)) return erro("Usuário não encontrado.");
  return respostaJSON({ status: "success", message: req.novaSenha !== undefined ? "Senha redefinida!" : "Usuário atualizado!" });
}

function atualizarCitacao(req, sessao) {
  if (STATUS_CITACAO.indexOf(req.status) < 0) return erro("Status inválido.");
  const c = lerAba(SpreadsheetApp.getActiveSpreadsheet(), ABAS.citacoes)
    .filter(function (x) { return String(x.ID_Citacao) === String(req.idCitacao); })[0];
  if (!c) return erro("Citação não encontrada.");
  if (sessao.nivel !== "ADMIN" && String(c.Apelido).toLowerCase() !== String(sessao.apelido).toLowerCase()) {
    return erro("Só a pessoa citada pode alterar esta citação.");
  }
  atualizar(ABAS.citacoes, "ID_Citacao", req.idCitacao, { Status: req.status, Atualizado_Em: new Date() });
  return respostaJSON({ status: "success", message: "Citação marcada como " + req.status.toLowerCase() + "." });
}

function addEncaminhamento(req) {
  if (!existe(ABAS.ideias, "ID_Ideia", req.idIdeia)) return erro("Pauta não encontrada.");
  const acao = texto(req.acaoTexto, 2000);
  const responsavel = texto(req.responsavel, 120);
  if (!acao || !responsavel) return erro("Informe a ação e o responsável.");

  const agora = new Date();
  inserir(ABAS.encaminhamentos, {
    ID_Encaminhamento: "ENC-" + agora.getTime(),
    ID_Ideia: req.idIdeia,
    Acao: acao,
    Responsavel: responsavel,
    Prazo: dataISO(req.prazo),
    Status: "Pendente",
    Data_Criacao: agora,
    Atualizado_Em: agora
  });
  // Encaminhamento criado a partir de uma citação: a citação fica como "Encaminhada"
  if (req.idCitacao) {
    atualizar(ABAS.citacoes, "ID_Citacao", req.idCitacao, { Status: "Encaminhada", Atualizado_Em: agora });
  }
  return respostaJSON({ status: "success", message: "Encaminhamento registrado!" });
}

function atualizarEncaminhamento(req) {
  if (STATUS_ENCAMINHAMENTO.indexOf(req.status) < 0) return erro("Status inválido.");
  const ok = atualizar(ABAS.encaminhamentos, "ID_Encaminhamento", req.idEncaminhamento, {
    Status: req.status,
    Atualizado_Em: new Date()
  });
  if (!ok) return erro("Encaminhamento não encontrado.");
  return respostaJSON({ status: "success", message: "Encaminhamento atualizado!" });
}

/* ------------------------------------------------------------------ */
/* Inteligência Artificial — Gemini (Google) com Groq como reserva     */
/*                                                                     */
/* Propriedades do script:                                             */
/*   GEMINI_API_KEY  → chave gerada em https://aistudio.google.com     */
/*   GEMINI_MODELO   → opcional (escolhido sozinho se o atual sumir)   */
/*   GROQ_API_KEY    → chave gerada em https://console.groq.com/keys   */
/*   GROQ_MODELO     → opcional (escolhido sozinho se o atual sumir)   */
/*   IA_PRINCIPAL    → opcional: "groq" para usar o Groq primeiro      */
/* Basta uma das chaves. Com as duas, se a principal falhar            */
/* (sobrecarga, limite, erro), a outra responde automaticamente.       */
/* A IA apenas SUGERE; nada é gravado até um colaborador adotar.       */
/* ------------------------------------------------------------------ */

const GEMINI_MODELO_PADRAO = "gemini-2.5-flash";
const GROQ_MODELO_PADRAO = "llama-3.3-70b-versatile";

/** Chama a IA principal e, se ela falhar, a reserva. Retorna { json, provedor } ou { erro }. */
function chamarIA(prompt) {
  const props = PropertiesService.getScriptProperties();
  const disponiveis = [];
  if (props.getProperty("GEMINI_API_KEY")) disponiveis.push("gemini");
  if (props.getProperty("GROQ_API_KEY")) disponiveis.push("groq");
  if (!disponiveis.length) {
    return { erro: "IA não configurada: cadastre GEMINI_API_KEY ou GROQ_API_KEY nas Propriedades do script." };
  }
  if (String(props.getProperty("IA_PRINCIPAL") || "").toLowerCase() === "groq") disponiveis.reverse();

  const temReserva = disponiveis.length > 1;
  const erros = [];
  for (let i = 0; i < disponiveis.length; i++) {
    const provedor = disponiveis[i];
    // Com reserva disponível, a principal desiste mais rápido (menos espera na tela)
    const r = provedor === "gemini" ? chamarGemini(prompt, { rapido: temReserva }) : chamarGroq(prompt);
    if (r.json) return { json: r.json, provedor: provedor };
    erros.push((provedor === "gemini" ? "Gemini" : "Groq") + ": " + r.erro);
  }
  return { erro: erros.join(" | ") };
}

function iaSugerirPautas(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ideias = lerAba(ss, ABAS.ideias);
  const encs = lerAba(ss, ABAS.encaminhamentos);

  const existentes = ideias.map(function (i) {
    return "- [" + i.Status + "] " + i.Titulo + (i.Descricao ? ": " + String(i.Descricao).slice(0, 300) : "");
  }).join("\n") || "(nenhuma pauta cadastrada)";
  const pendentes = encs.filter(function (e) { return e.Status === "Pendente" || e.Status === "Em Andamento"; })
    .map(function (e) { return "- " + e.Acao + " (resp.: " + e.Responsavel + ")"; })
    .join("\n") || "(nenhum)";

  const prompt =
    "Você assessora um grupo de trabalho que organiza reuniões, pautas e encaminhamentos.\n" +
    "Sugira de 3 a 5 NOVAS pautas para as próximas reuniões, sem repetir as existentes.\n" +
    (req.tema ? "Foco solicitado pelo grupo: " + texto(req.tema, 500) + "\n" : "") +
    "\nPautas já cadastradas:\n" + existentes +
    "\n\nEncaminhamentos em aberto:\n" + pendentes +
    "\n\nResponda em português do Brasil, em JSON no formato " +
    '{"sugestoes":[{"titulo":"até 100 caracteres","descricao":"2 a 4 frases com contexto e objetivo","justificativa":"1 frase"}]}';

  const r = chamarIA(prompt);
  if (r.erro) return erro(r.erro);
  return respostaJSON({ status: "success", sugestoes: (r.json.sugestoes || []).slice(0, 5) });
}

function iaSugerirEncaminhamentos(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ideia = lerAba(ss, ABAS.ideias).filter(function (i) { return String(i.ID_Ideia) === String(req.idIdeia); })[0];
  if (!ideia) return erro("Pauta não encontrada.");

  // Discussão em fio: cada sugestão seguida dos seus comentários
  const daPauta = lerAba(ss, ABAS.interacoes)
    .filter(function (i) { return String(i.ID_Ideia) === String(req.idIdeia); });
  const filhos = function (id) { return daPauta.filter(function (i) { return String(i.ID_Pai) === String(id); }); };
  const discussao = daPauta.filter(function (i) { return !i.ID_Pai; })
    .map(function (i) {
      return "- (" + i.Tipo + ") " + i.Autor + ": " + i.Texto +
        filhos(i.ID_Interacao).map(function (c) { return "\n    • comentário de " + c.Autor + ": " + c.Texto; }).join("");
    })
    .join("\n") || "(sem sugestões ainda)";
  const jaEncaminhado = lerAba(ss, ABAS.encaminhamentos)
    .filter(function (e) { return String(e.ID_Ideia) === String(req.idIdeia); })
    .map(function (e) { return "- [" + e.Status + "] " + e.Acao + " (resp.: " + e.Responsavel + ")"; })
    .join("\n") || "(nenhum)";

  const prompt =
    "Você assessora um grupo de trabalho. Analise a pauta e a discussão abaixo.\n" +
    "1) Escreva uma síntese objetiva do que foi debatido (pontos de consenso e divergências).\n" +
    "2) Sugira de 2 a 5 encaminhamentos concretos e verificáveis, sem repetir os já registrados.\n" +
    "Só indique um responsável se a discussão apontar alguém; caso contrário deixe vazio.\n" +
    "\nPauta: " + ideia.Titulo +
    "\nContexto: " + (ideia.Descricao || "(sem descrição)") +
    "\n\nDiscussão:\n" + discussao +
    "\n\nEncaminhamentos já registrados:\n" + jaEncaminhado +
    "\n\nResponda em português do Brasil, em JSON no formato " +
    '{"sintese":"texto","encaminhamentos":[{"acao":"verbo no infinitivo + entrega","responsavel":"nome ou vazio","prazoDias":número de dias sugerido}]}';

  const r = chamarIA(prompt);
  if (r.erro) return erro(r.erro);
  return respostaJSON({
    status: "success",
    sintese: r.json.sintese || "",
    encaminhamentos: (r.json.encaminhamentos || []).slice(0, 5)
  });
}

function chamarGemini(prompt, opcoes) {
  const rapido = !!(opcoes && opcoes.rapido);
  const props = PropertiesService.getScriptProperties();
  const chave = props.getProperty("GEMINI_API_KEY");
  if (!chave) return { erro: "IA não configurada: cadastre GEMINI_API_KEY nas Propriedades do script." };
  let modelo = props.getProperty("GEMINI_MODELO") || GEMINI_MODELO_PADRAO;
  const pausas = rapido ? PAUSAS_REPETICAO_MS.slice(0, 1) : PAUSAS_REPETICAO_MS;

  let resp = gerarComRepeticao(chave, modelo, prompt, pausas);
  let codigo = resp.getResponseCode();

  // Modelo aposentado/inexistente: escolhe um "flash" disponível para a chave,
  // guarda em GEMINI_MODELO e tenta de novo
  if (codigo === 404) {
    const alternativo = escolherModeloDisponivel(chave, modelo);
    if (alternativo) {
      props.setProperty("GEMINI_MODELO", alternativo);
      modelo = alternativo;
      resp = gerarComRepeticao(chave, modelo, prompt, pausas);
      codigo = resp.getResponseCode();
    }
  }

  // Sobrecarga persistente: usa outro modelo flash só nesta chamada (sem gravar).
  // No modo rápido pula esta etapa — o Groq assume no lugar.
  if (sobrecarga(codigo) && !rapido) {
    const reserva = escolherModeloReserva(chave, modelo);
    if (reserva) {
      const r2 = gerarComRepeticao(chave, reserva, prompt, pausas);
      if (r2.getResponseCode() === 200) {
        resp = r2;
        codigo = 200;
      }
    }
  }
  if (codigo !== 200) return { erro: mensagemErroGemini(codigo, resp.getContentText(), modelo) };

  try {
    const corpo = JSON.parse(resp.getContentText());
    const saida = corpo.candidates[0].content.parts.map(function (p) { return p.text || ""; }).join("");
    return { json: JSON.parse(saida) };
  } catch (e) {
    return { erro: "Não foi possível interpretar a resposta da IA." };
  }
}

function gerarConteudo(chave, modelo, prompt) {
  return UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(modelo) + ":generateContent",
    {
      method: "post",
      contentType: "application/json",
      headers: { "x-goog-api-key": chave },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, responseMimeType: "application/json" }
      })
    }
  );
}

const PAUSAS_REPETICAO_MS = [2000, 5000];
const sobrecarga = function (codigo) { return codigo === 503 || codigo === 500 || codigo === 502 || codigo === 504; };

/** Repete a chamada em caso de sobrecarga temporária do Gemini (503/500), com pausas crescentes. */
function gerarComRepeticao(chave, modelo, prompt, pausas) {
  pausas = pausas || PAUSAS_REPETICAO_MS;
  let resp = gerarConteudo(chave, modelo, prompt);
  for (let i = 0; i < pausas.length && sobrecarga(resp.getResponseCode()); i++) {
    Utilities.sleep(pausas[i]);
    resp = gerarConteudo(chave, modelo, prompt);
  }
  return resp;
}

/** Outro modelo flash para socorrer quando o principal está sobrecarregado (aceita "lite"). */
function escolherModeloReserva(chave, atual) {
  const nomes = listarModelos(chave);
  if (!nomes) return null;
  const evitar = /(preview|exp|thinking|image|tts|audio|live|vision|embedding|learnlm)/i;
  const versao = function (n) { const m = n.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  return nomes
    .filter(function (n) { return /flash/i.test(n) && n !== atual && !evitar.test(n); })
    .sort(function (a, b) { return versao(b) - versao(a) || a.length - b.length; })[0] || null;
}

/** Modelos de texto que a chave pode usar (nomes sem o prefixo "models/"). */
function listarModelos(chave) {
  const resp = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
    headers: { "x-goog-api-key": chave },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) return null;
  return (JSON.parse(resp.getContentText()).models || [])
    .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0; })
    .map(function (m) { return String(m.name).replace(/^models\//, ""); });
}

/**
 * Escolhe o melhor modelo "flash" estável disponível: prefere versões mais novas
 * e evita variantes especiais (lite, preview, experimental, imagem, áudio...).
 */
function escolherModeloDisponivel(chave, atual) {
  const nomes = listarModelos(chave);
  if (!nomes) return null;
  const especial = /(lite|preview|exp|thinking|image|tts|audio|live|vision|embedding|8b|learnlm)/i;
  const versao = function (n) { const m = n.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  const candidatos = nomes.filter(function (n) { return /flash/i.test(n) && n !== atual; });
  const estaveis = candidatos.filter(function (n) { return !especial.test(n); });
  const lista = (estaveis.length ? estaveis : candidatos).sort(function (a, b) {
    return versao(b) - versao(a) || a.length - b.length; // mais nova; depois o nome mais simples (ex.: sem "-001")
  });
  return lista[0] || null;
}

/** Traduz os erros mais comuns da API do Gemini em instruções para quem configura. */
function mensagemErroGemini(codigo, corpo, modelo) {
  let detalhe = "";
  try { detalhe = String(JSON.parse(corpo).error.message || ""); } catch (e) {}
  if (codigo === 429) return "Limite gratuito da IA atingido. Tente novamente em alguns minutos.";
  if (sobrecarga(codigo)) return "A IA do Google está sobrecarregada no momento (já tentamos de novo automaticamente). Aguarde 1 ou 2 minutos e clique outra vez.";
  if (codigo === 400 && /api key/i.test(detalhe)) return "A GEMINI_API_KEY é inválida. Gere uma nova chave no Google AI Studio e atualize as Propriedades do script.";
  if (codigo === 403) return "A chave do Gemini não tem permissão (" + (detalhe || "acesso negado") + "). Confira a chave e o projeto no Google AI Studio.";
  if (codigo === 404) return "O modelo \"" + modelo + "\" não está disponível. Rode a função testarGemini no editor para ver os modelos disponíveis e ajuste GEMINI_MODELO.";
  return "A IA retornou erro " + codigo + (detalhe ? ": " + detalhe : ".");
}

/**
 * Execute pelo editor do Apps Script (selecione testarGemini → Executar) para
 * conferir a configuração da IA. O resultado aparece no Registro de execução.
 */
function testarGemini() {
  const props = PropertiesService.getScriptProperties();
  const chave = props.getProperty("GEMINI_API_KEY");
  if (!chave) {
    Logger.log("❌ GEMINI_API_KEY não cadastrada. Configurações do projeto (⚙) → Propriedades do script → Adicionar propriedade.");
    return;
  }
  const modelo = props.getProperty("GEMINI_MODELO") || GEMINI_MODELO_PADRAO;
  Logger.log("Chave encontrada (termina em …" + chave.slice(-4) + "). Testando o modelo " + modelo + "...");

  const r = chamarGemini('Responda apenas com o JSON {"ok": true, "mensagem": "IA funcionando"}');
  const usado = props.getProperty("GEMINI_MODELO") || GEMINI_MODELO_PADRAO;
  if (r.json) {
    if (usado !== modelo) Logger.log("ℹ️ O modelo " + modelo + " não existe mais; foi escolhido automaticamente " + usado + " (gravado em GEMINI_MODELO).");
    Logger.log("✅ IA funcionando com o modelo " + usado + ". Resposta: " + JSON.stringify(r.json));
    return;
  }
  Logger.log("❌ " + r.erro);

  // Lista os modelos que a chave pode usar, para ajudar a escolher o GEMINI_MODELO
  const nomes = listarModelos(chave);
  if (!nomes) {
    Logger.log("Não foi possível listar os modelos. A chave provavelmente é inválida.");
    return;
  }
  Logger.log("Modelos \"flash\" disponíveis para esta chave (use um deles em GEMINI_MODELO):\n  " +
    nomes.filter(function (n) { return /flash/i.test(n); }).join("\n  "));
}

/* ---------- Groq (API compatível com OpenAI) ---------- */

const GROQ_URL = "https://api.groq.com/openai/v1";

function chamarGroq(prompt) {
  const props = PropertiesService.getScriptProperties();
  const chave = props.getProperty("GROQ_API_KEY");
  if (!chave) return { erro: "Groq não configurado: cadastre GROQ_API_KEY nas Propriedades do script." };
  let modelo = props.getProperty("GROQ_MODELO") || GROQ_MODELO_PADRAO;

  let resp = conversarGroq(chave, modelo, prompt);
  let codigo = resp.getResponseCode();

  // Modelo desativado/inexistente: escolhe outro de texto disponível e grava em GROQ_MODELO
  if (codigo === 404 || (codigo === 400 && /decommission|not found|does not exist|model_not_found/i.test(resp.getContentText()))) {
    const alternativo = escolherModeloGroq(chave, modelo);
    if (alternativo) {
      props.setProperty("GROQ_MODELO", alternativo);
      modelo = alternativo;
      resp = conversarGroq(chave, modelo, prompt);
      codigo = resp.getResponseCode();
    }
  }
  if (sobrecarga(codigo)) {
    Utilities.sleep(PAUSAS_REPETICAO_MS[0]);
    resp = conversarGroq(chave, modelo, prompt);
    codigo = resp.getResponseCode();
  }
  if (codigo !== 200) return { erro: mensagemErroGroq(codigo, resp.getContentText(), modelo) };

  try {
    const corpo = JSON.parse(resp.getContentText());
    return { json: JSON.parse(corpo.choices[0].message.content) };
  } catch (e) {
    return { erro: "Não foi possível interpretar a resposta do Groq." };
  }
}

function conversarGroq(chave, modelo, prompt) {
  return UrlFetchApp.fetch(GROQ_URL + "/chat/completions", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + chave },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: modelo,
      temperature: 0.6,
      response_format: { type: "json_object" }, // o prompt precisa mencionar JSON (os nossos mencionam)
      messages: [{ role: "user", content: prompt }]
    })
  });
}

/** Modelos de chat disponíveis no Groq (exclui transcrição de áudio, voz e moderação). */
function listarModelosGroq(chave) {
  const resp = UrlFetchApp.fetch(GROQ_URL + "/models", {
    headers: { Authorization: "Bearer " + chave },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) return null;
  return (JSON.parse(resp.getContentText()).data || [])
    .filter(function (m) { return m.active !== false; })
    .map(function (m) { return String(m.id); })
    .filter(function (id) { return !/(whisper|tts|guard|playai|orpheus|distil|embed|vision|speech|audio)/i.test(id); });
}

/** Prefere modelos grandes e de uso geral (70b/120b/"versatile"); senão o primeiro de texto. */
function escolherModeloGroq(chave, atual) {
  const nomes = listarModelosGroq(chave);
  if (!nomes) return null;
  const nota = function (id) {
    let n = 0;
    if (/(120b|70b|versatile)/i.test(id)) n += 10;
    if (/(llama|gpt-oss|qwen|kimi|deepseek)/i.test(id)) n += 2;
    if (/(instant|8b|mini|preview)/i.test(id)) n -= 5;
    return n;
  };
  return nomes.filter(function (id) { return id !== atual; })
    .sort(function (a, b) { return nota(b) - nota(a) || a.length - b.length; })[0] || null;
}

function mensagemErroGroq(codigo, corpo, modelo) {
  let detalhe = "";
  try { detalhe = String(JSON.parse(corpo).error.message || ""); } catch (e) {}
  if (codigo === 401) return "A GROQ_API_KEY é inválida. Gere uma nova chave em console.groq.com/keys e atualize as Propriedades do script.";
  if (codigo === 429) return "Limite gratuito do Groq atingido. Tente novamente em alguns minutos.";
  if (sobrecarga(codigo)) return "O Groq está sobrecarregado no momento. Tente novamente em instantes.";
  if (codigo === 404) return "O modelo \"" + modelo + "\" não está disponível no Groq. Rode testarIA para ver os modelos e ajuste GROQ_MODELO.";
  return "O Groq retornou erro " + codigo + (detalhe ? ": " + detalhe : ".");
}

function testarGroq() {
  const props = PropertiesService.getScriptProperties();
  const chave = props.getProperty("GROQ_API_KEY");
  if (!chave) {
    Logger.log("— Groq: GROQ_API_KEY não cadastrada (opcional). Crie em https://console.groq.com/keys.");
    return false;
  }
  const modelo = props.getProperty("GROQ_MODELO") || GROQ_MODELO_PADRAO;
  Logger.log("Groq: chave encontrada (termina em …" + chave.slice(-4) + "). Testando o modelo " + modelo + "...");
  const r = chamarGroq('Responda apenas com o JSON {"ok": true, "mensagem": "IA funcionando"}');
  const usado = props.getProperty("GROQ_MODELO") || GROQ_MODELO_PADRAO;
  if (r.json) {
    if (usado !== modelo) Logger.log("ℹ️ O modelo " + modelo + " não existe mais no Groq; foi escolhido " + usado + " (gravado em GROQ_MODELO).");
    Logger.log("✅ Groq funcionando com o modelo " + usado + ".");
    return true;
  }
  Logger.log("❌ Groq: " + r.erro);
  const nomes = listarModelosGroq(chave);
  if (nomes) Logger.log("Modelos de texto disponíveis no Groq (use um em GROQ_MODELO):\n  " + nomes.join("\n  "));
  return false;
}

/**
 * Execute pelo editor (selecione testarIA → Executar) para conferir as duas IAs
 * e ver qual responde primeiro. O resultado aparece no Registro de execução.
 */
function testarIA() {
  const props = PropertiesService.getScriptProperties();
  Logger.log("===== Gemini =====");
  if (props.getProperty("GEMINI_API_KEY")) testarGemini();
  else Logger.log("— Gemini: GEMINI_API_KEY não cadastrada.");
  Logger.log("===== Groq =====");
  testarGroq();
  const ordem = [];
  if (props.getProperty("GEMINI_API_KEY")) ordem.push("Gemini");
  if (props.getProperty("GROQ_API_KEY")) ordem.push("Groq");
  if (String(props.getProperty("IA_PRINCIPAL") || "").toLowerCase() === "groq") ordem.reverse();
  Logger.log("===== Ordem de uso =====\n" + (ordem.length
    ? ordem.join(" → depois → ") + (ordem.length > 1 ? "  (se a primeira falhar, a segunda responde)" : "")
    : "Nenhuma IA configurada."));
}

/* ------------------------------------------------------------------ */
/* Configuração inicial — execute uma vez pelo editor                  */
/* ------------------------------------------------------------------ */

function configurar() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SENHA_ADMIN")) {
    // Planilhas antigas: a senha de escrita vira a senha do admin; senão gera uma aleatória
    const antiga = props.getProperty("SENHA_ESCRITA");
    const nova = antiga || Utilities.getUuid().replace(/-/g, "").slice(0, 12);
    props.setProperty("SENHA_ADMIN", nova);
    if (!antiga) Logger.log("🔑 SENHA_ADMIN gerada: " + nova + "  (anote; você pode trocá-la nas Propriedades do script)");
  }
  if (!props.getProperty("SENHA_LEITURA")) {
    Logger.log("ℹ️ SENHA_LEITURA não definida: o acesso de observador sem cadastro está desligado. Defina a propriedade para ligá-lo.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(ABAS).forEach(function (k) { garantirAba(ss, ABAS[k]); });
  Logger.log("Planilha configurada. Entre com o usuário admin e a SENHA_ADMIN para cadastrar os usuários.");
}

/* ------------------------------------------------------------------ */
/* Utilitários de planilha                                             */
/* ------------------------------------------------------------------ */

function garantirAba(ss, def) {
  let sheet = ss.getSheetByName(def.nome);
  if (!sheet) sheet = ss.insertSheet(def.nome);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, def.colunas.length).setValues([def.colunas]);
  } else {
    // Acrescenta ao final as colunas que ainda não existem (planilhas antigas)
    const atuais = cabecalho(sheet);
    const presentes = atuais.map(function (h) { return canonico(def, h); });
    const faltando = def.colunas.filter(function (c) { return presentes.indexOf(c) < 0; });
    if (faltando.length) {
      sheet.getRange(1, atuais.length + 1, 1, faltando.length).setValues([faltando]);
    }
  }
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight("bold").setBackground("#f6e8ea");
  sheet.setFrozenRows(1);
  return sheet;
}

function cabecalho(sheet) {
  if (sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

/** "Título da Pauta" → "titulodapauta" */
function normalizar(h) {
  return String(h).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Nome padrão (de def.colunas) correspondente a um cabeçalho da planilha, ou null. */
function canonico(def, h) {
  const n = normalizar(h);
  if (!n) return null;
  for (let i = 0; i < def.colunas.length; i++) {
    const c = def.colunas[i];
    if (normalizar(c) === n || ((def.apelidos || {})[c] || []).indexOf(n) >= 0) return c;
  }
  return null;
}

/** Índices (base 0) de todas as colunas que representam o campo — pode haver duplicadas. */
function colunasDo(def, headers, campo) {
  const cols = [];
  headers.forEach(function (h, i) { if (canonico(def, h) === campo) cols.push(i); });
  return cols;
}

// Leituras guardadas durante a execução atual (cada aba é lida no máximo uma vez
// por requisição); qualquer gravação na aba descarta a cópia.
const _memoAbas = {};

function lerAba(ss, def) {
  if (_memoAbas[def.nome]) return _memoAbas[def.nome];
  const sheet = ss.getSheetByName(def.nome);
  if (!sheet || sheet.getLastRow() <= 1) return (_memoAbas[def.nome] = []);
  const values = sheet.getDataRange().getValues();
  // Nome padrão de cada coluna calculado uma única vez (não por célula)
  const chaves = values[0].map(function (h) { return canonico(def, h) || String(h); });
  const n = chaves.length;
  const lista = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    let vazia = true;
    const obj = {};
    for (let i = 0; i < n; i++) {
      let valor = row[i];
      if (valor !== "") vazia = false;
      if (valor instanceof Date) valor = valor.toISOString();
      // Em colunas duplicadas, prevalece o valor preenchido
      const atual = obj[chaves[i]];
      if (atual === undefined || atual === "") obj[chaves[i]] = valor;
    }
    if (!vazia) lista.push(obj);
  }
  return (_memoAbas[def.nome] = lista);
}

function descartarMemo(def) {
  delete _memoAbas[def.nome];
}

function inserir(def, registro) {
  const sheet = garantirAba(SpreadsheetApp.getActiveSpreadsheet(), def);
  const linha = cabecalho(sheet).map(function (h) {
    const c = canonico(def, h);
    return c && registro[c] !== undefined ? registro[c] : "";
  });
  sheet.appendRow(linha);
  descartarMemo(def);
}

function localizarLinha(sheet, def, colunaId, id) {
  if (!id || sheet.getLastRow() <= 1) return -1;
  const cols = colunasDo(def, cabecalho(sheet), colunaId);
  for (let k = 0; k < cols.length; k++) {
    const ids = sheet.getRange(2, cols[k] + 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) return i + 2;
    }
  }
  return -1;
}

function existe(def, colunaId, id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.nome);
  return !!sheet && localizarLinha(sheet, def, colunaId, id) > 0;
}

function atualizar(def, colunaId, id, campos) {
  const sheet = garantirAba(SpreadsheetApp.getActiveSpreadsheet(), def);
  const linha = localizarLinha(sheet, def, colunaId, id);
  if (linha < 0) return false;
  const headers = cabecalho(sheet);
  Object.keys(campos).forEach(function (campo) {
    colunasDo(def, headers, campo).forEach(function (col) {
      sheet.getRange(linha, col + 1).setValue(campos[campo]);
      descartarMemo(def);
    });
  });
  return true;
}

/** Apaga as linhas cujo campo colunaId está em ids (de baixo para cima, para não deslocar índices). */
function excluirLinhas(def, colunaId, ids) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.nome);
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  const cols = colunasDo(def, cabecalho(sheet), colunaId);
  if (!cols.length) return 0;
  const valores = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  let apagadas = 0;
  for (let i = valores.length - 1; i >= 0; i--) {
    const bate = cols.some(function (c) { return ids.indexOf(String(valores[i][c])) >= 0; });
    if (bate) {
      sheet.deleteRow(i + 2);
      descartarMemo(def);
      apagadas++;
    }
  }
  return apagadas;
}

/** Execute pelo editor para ver, em Execuções/Log, como cada coluna foi reconhecida. */
function diagnosticar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(ABAS).forEach(function (k) {
    const def = ABAS[k];
    const sheet = ss.getSheetByName(def.nome);
    if (!sheet) return Logger.log(def.nome + ": ABA NÃO ENCONTRADA");
    const mapa = cabecalho(sheet).map(function (h, i) {
      return String.fromCharCode(65 + i) + "=" + h + " → " + (canonico(def, h) || "(ignorada)");
    });
    Logger.log(def.nome + " (" + (sheet.getLastRow() - 1) + " linhas): " + mapa.join(" | "));
  });
}

/* ------------------------------------------------------------------ */
/* Utilitários gerais                                                  */
/* ------------------------------------------------------------------ */

function texto(valor, max) {
  return String(valor === undefined || valor === null ? "" : valor).trim().slice(0, max);
}

/** Retorna "" para vazio, o link se for Google Docs/Drive, ou null se inválido. */
function linkDoc(valor) {
  const link = texto(valor, 500);
  if (!link) return "";
  return /^https:\/\/(docs|drive)\.google\.com\//.test(link) ? link : null;
}

/** Mantém a data como texto yyyy-mm-dd para o Sheets não converter fuso. */
function dataISO(valor) {
  const v = texto(valor, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? "'" + v : "";
}

function erro(msg) {
  return respostaJSON({ status: "error", message: msg });
}

function respostaJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
