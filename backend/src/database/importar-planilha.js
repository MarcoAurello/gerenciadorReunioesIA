/*
 * Importa a planilha do protótipo (Google Sheets baixado como .xlsx) para o MySQL.
 *
 * Uso:  npm run importar -- caminho/da/planilha.xlsx [--substituir]
 *
 * - Lê cada aba pelo nome do cabeçalho (como o Code.gs fazia), onde quer que ele esteja na linha 1.
 * - Mantém os IDs da planilha e as senhas (o hash antigo vira bcrypt no primeiro login).
 * - Tudo numa transação: se algo falhar, nada é gravado.
 * - Com dados já no banco, só roda com --substituir (apaga pautas, usuários, grupos e metadados antes).
 */
require("dotenv").config();
const XLSX = require("xlsx");
const { Sequelize, QueryTypes } = require("sequelize");
const dbConfig = require("../config/database");

const GRUPO_PADRAO = "GT-SISTEMAS";
const STATUS_ENTREGA_ANTIGO = { "Aguardando entrega": "Aguardando análise", "Em análise": "Aguardando análise", "Concluído": "Aprovado" };

// Outros nomes aceitos no cabeçalho (os mesmos apelidos do Code.gs)
const APELIDOS = {
  ID_Ideia: ["id", "codigo", "ideia", "idpauta"],
  ID_Grupo: ["grupo", "gt", "idgt"],
  Data_Criacao: ["data", "datacadastro", "criadoem", "datahora", "timestamp"],
  Titulo: ["assunto", "tema", "pauta"],
  Descricao: ["contexto", "detalhes", "descricaocontexto"],
  ID_Interacao: ["id", "codigo"],
  ID_Pai: ["idsugestao", "sugestaopai", "pai"],
  Texto: ["comentario", "mensagem", "conteudo", "sugestao"],
  Data: ["datahora", "criadoem", "timestamp"],
  ID_Encaminhamento: ["id", "codigo"],
  ID_Entregas: ["identrega", "entregas"],
  Acao: ["acaotexto", "encaminhamento", "descricao", "tarefa"],
  ID_Entrega: ["id", "codigo"],
  Data_Entrega: ["data", "dataentrega", "prazo", "entrega"],
  Comentarios: ["comentario", "observacao", "observacoes", "obs"]
};

const normalizar = (h) => String(h).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Linhas da aba como objetos { coluna: valor }, usando só as colunas da lista. Colunas duplicadas: vale a preenchida. */
function lerAba(wb, nome, colunas) {
  const sheet = wb.Sheets[nome];
  if (!sheet) return [];
  const grade = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  if (!grade.length) return [];
  const chaves = grade[0].map((h) => {
    const n = normalizar(h);
    if (!n) return null;
    return colunas.find((c) => normalizar(c) === n) || colunas.find((c) => (APELIDOS[c] || []).includes(n)) || null;
  });
  const linhas = [];
  for (const linha of grade.slice(1)) {
    const obj = {};
    linha.forEach((v, i) => {
      const c = chaves[i];
      if (c && (obj[c] === undefined || obj[c] === "")) obj[c] = v;
    });
    if (Object.values(obj).some((v) => v !== "")) linhas.push(obj);
  }
  return linhas;
}

const txt = (v, max) => String(v === undefined || v === null ? "" : v).trim().slice(0, max);
const ativo = (v) => v === true || /^(sim|true)$/i.test(String(v));

/** Data/hora da planilha (número serial do Excel, no horário de Recife, UTC-3) → Date. */
function dataHora(v) {
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000) + 3 * 3600000);
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Data sem hora → "yyyy-mm-dd" (a planilha guarda como texto, às vezes com apóstrofo, ou como serial). */
function dataISO(v) {
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v || "").replace(/^'/, "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function importar(arquivo, substituir) {
  const wb = XLSX.readFile(arquivo);
  const aba = {
    grupos: lerAba(wb, "Grupos_GT", ["ID_Grupo", "Nome", "Descricao", "Ativo", "Data_Criacao"]),
    usuarios: lerAba(wb, "Usuarios_GT", ["ID_Usuario", "Nome", "Apelido", "Email", "Perfil", "Ativo", "Senha_Hash", "Data_Criacao"]),
    ideias: lerAba(wb, "Ideias_GT", ["ID_Ideia", "ID_Grupo", "Data_Criacao", "Titulo", "Descricao", "Status", "Autor", "Atualizado_Em", "Link_Doc_Oficial"]),
    interacoes: lerAba(wb, "Interacoes_GT", ["ID_Interacao", "ID_Ideia", "ID_Pai", "Tipo", "Autor", "Texto", "Data"]),
    curtidas: lerAba(wb, "Curtidas_GT", ["ID_Curtida", "ID_Ideia", "ID_Interacao", "Apelido", "Nome", "Data"]),
    citacoes: lerAba(wb, "Citacoes_GT", ["ID_Citacao", "ID_Ideia", "ID_Interacao", "Apelido", "Autor", "Trecho", "Status", "Data", "Atualizado_Em"]),
    encaminhamentos: lerAba(wb, "Encaminhamentos_GT", ["ID_Encaminhamento", "ID_Ideia", "Acao", "Responsavel", "Prazo", "Status", "Data_Criacao", "Atualizado_Em", "ID_Entregas"]),
    entregas: lerAba(wb, "Entregas_GT", ["ID_Entrega", "ID_Ideia", "Data_Entrega", "Responsavel", "Comentarios", "Status", "Anexo_ID", "Anexo_Nome", "Autor", "Data_Criacao", "Atualizado_Em"]),
    recomendacoes: lerAba(wb, "Recomendacoes_IA", ["ID_Recomendacao", "ID_Grupo", "Titulo", "Texto", "Ativo", "Autor", "Data_Criacao", "Atualizado_Em"])
  };

  const avisos = [];
  const agora = new Date();
  const env = process.env.NODE_ENV || "development";
  const sequelize = new Sequelize(dbConfig[env]);

  try {
    const [{ qtd }] = await sequelize.query("SELECT COUNT(*) AS qtd FROM ideias", { type: QueryTypes.SELECT });
    if (qtd > 0 && !substituir) {
      throw new Error(`O banco já tem ${qtd} pauta(s). Rode de novo com --substituir para apagar os dados atuais e importar.`);
    }

    await sequelize.transaction(async (transaction) => {
      const qi = sequelize.getQueryInterface();
      const inserir = (tabela, linhas) => (linhas.length ? qi.bulkInsert(tabela, linhas, { transaction }) : null);

      if (substituir) {
        // Pautas levam junto interações, curtidas, citações, encaminhamentos e entregas (FK em cascata)
        for (const t of ["ideias", "recomendacoes_ia", "usuarios"]) await qi.bulkDelete(t, {}, { transaction });
        await qi.bulkDelete("grupos", { id_grupo: { [Sequelize.Op.ne]: GRUPO_PADRAO } }, { transaction });
      }

      /* Grupos (o GT-Sistemas já existe pelo seeder) */
      const grupos = new Map(aba.grupos.filter((g) => txt(g.ID_Grupo, 40)).map((g) => [txt(g.ID_Grupo, 40), g]));
      // Grupo apagado da aba Grupos_GT = descartado (o protótipo também não o mostrava): as pautas e
      // os metadados dele ficam de fora
      const grupoExiste = (id) => !id || id === GRUPO_PADRAO || grupos.has(id);
      const descartados = [...new Set(aba.ideias.map((i) => txt(i.ID_Grupo, 40)).filter((id) => !grupoExiste(id)))];
      descartados.forEach((id) => {
        const qtd = aba.ideias.filter((i) => txt(i.ID_Grupo, 40) === id).length;
        avisos.push(`Grupo ${id} não está na aba Grupos_GT: as ${qtd} pauta(s) dele não foram importadas.`);
      });
      aba.ideias = aba.ideias.filter((i) => grupoExiste(txt(i.ID_Grupo, 40)));
      aba.recomendacoes = aba.recomendacoes.filter((r) => grupoExiste(txt(r.ID_Grupo, 40)));
      const padrao = grupos.get(GRUPO_PADRAO);
      if (padrao) {
        await qi.bulkUpdate("grupos", { nome: txt(padrao.Nome, 80) || "GT-Sistemas", descricao: txt(padrao.Descricao, 500), ativo: ativo(padrao.Ativo) }, { id_grupo: GRUPO_PADRAO }, { transaction });
        grupos.delete(GRUPO_PADRAO);
      }
      await inserir("grupos", [...grupos.values()].map((g) => ({
        id_grupo: txt(g.ID_Grupo, 40), nome: txt(g.Nome, 80), descricao: txt(g.Descricao, 500),
        ativo: ativo(g.Ativo), data_criacao: dataHora(g.Data_Criacao) || agora
      })));

      /* Usuários */
      const perfis = ["Administrador", "Colaborador", "Leitura"];
      await inserir("usuarios", aba.usuarios.filter((u) => txt(u.Apelido, 60)).map((u) => ({
        id_usuario: txt(u.ID_Usuario, 40) || `USR-${Date.now()}-${txt(u.Apelido, 20)}`,
        nome: txt(u.Nome, 120),
        apelido: txt(u.Apelido, 60).toLowerCase(),
        email: txt(u.Email, 160).toLowerCase() || null,
        perfil: perfis.includes(u.Perfil) ? u.Perfil : "Colaborador",
        ativo: ativo(u.Ativo),
        senha_hash: txt(u.Senha_Hash, 255) || null,
        data_criacao: dataHora(u.Data_Criacao) || agora
      })));

      /* Pautas */
      const statusIdeia = ["Em Debate", "Em Redação", "Aprovada", "Arquivada"];
      const ideias = aba.ideias.filter((i) => txt(i.ID_Ideia, 40) && txt(i.Titulo, 200));
      const idsIdeias = new Set(ideias.map((i) => txt(i.ID_Ideia, 40)));
      await inserir("ideias", ideias.map((i) => {
        const link = txt(i.Link_Doc_Oficial, 1000);
        const descricao = txt(i.Descricao, 5000);
        return {
          id_ideia: txt(i.ID_Ideia, 40),
          id_grupo: txt(i.ID_Grupo, 40) || GRUPO_PADRAO,
          data_criacao: dataHora(i.Data_Criacao) || agora,
          titulo: txt(i.Titulo, 200),
          // O frontend nunca exibiu a coluna Link_Doc_Oficial: o link vai para o fim da descrição
          descricao: link ? `${descricao}${descricao ? "\n\n" : ""}Documento oficial: ${link}` : descricao,
          status: statusIdeia.includes(i.Status) ? i.Status : "Em Debate",
          autor: txt(i.Autor, 120),
          atualizado_em: dataHora(i.Atualizado_Em) || dataHora(i.Data_Criacao) || agora
        };
      }));
      const comLink = ideias.filter((i) => txt(i.Link_Doc_Oficial, 1000)).length;
      if (comLink) avisos.push(`${comLink} pauta(s) tinham Link_Doc_Oficial: o link foi acrescentado ao fim da descrição.`);

      /* Interações: sugestões primeiro, para os comentários acharem o pai */
      // Linhas sem ID nem texto (só com data) existem na planilha e o protótipo também não as exibia
      const preenchidas = aba.interacoes.filter((i) => txt(i.ID_Interacao, 40) || txt(i.Texto, 5000));
      const interacoes = preenchidas.filter((i) => txt(i.ID_Interacao, 40) && idsIdeias.has(txt(i.ID_Ideia, 40)) && txt(i.Texto, 5000));
      const vazias = aba.interacoes.length - preenchidas.length;
      const ignoradas = preenchidas.length - interacoes.length;
      if (vazias) avisos.push(`${vazias} linha(s) vazia(s) na aba Interacoes_GT (só com data) não foram importadas.`);
      if (ignoradas) avisos.push(`${ignoradas} interação(ões) ignorada(s): sem ID, sem texto ou de pauta inexistente.`);
      const idsInteracoes = new Set(interacoes.map((i) => txt(i.ID_Interacao, 40)));
      const linhasInteracao = interacoes.map((i) => {
        const pai = txt(i.ID_Pai, 40);
        return {
          id_interacao: txt(i.ID_Interacao, 40),
          id_ideia: txt(i.ID_Ideia, 40),
          id_pai: pai && idsInteracoes.has(pai) ? pai : null,
          // Sem tipo (registros antigos) = comentário avulso, como o protótipo já tratava
          tipo: i.Tipo === "Sugestão" ? "Sugestão" : "Comentário",
          autor: txt(i.Autor, 120),
          texto: txt(i.Texto, 5000),
          data: dataHora(i.Data) || agora
        };
      });
      await inserir("interacoes", linhasInteracao.filter((i) => !i.id_pai));
      await inserir("interacoes", linhasInteracao.filter((i) => i.id_pai));

      /* Curtidas (uma por usuário em cada sugestão) */
      const vistas = new Set();
      await inserir("curtidas", aba.curtidas
        .filter((c) => idsInteracoes.has(txt(c.ID_Interacao, 40)) && txt(c.Apelido, 60))
        .filter((c) => {
          const chave = `${txt(c.ID_Interacao, 40)}|${txt(c.Apelido, 60).toLowerCase()}`;
          return !vistas.has(chave) && vistas.add(chave);
        })
        .map((c) => ({
          id_curtida: txt(c.ID_Curtida, 40), id_ideia: txt(c.ID_Ideia, 40), id_interacao: txt(c.ID_Interacao, 40),
          apelido: txt(c.Apelido, 60).toLowerCase(), nome: txt(c.Nome, 120), data: dataHora(c.Data) || agora
        })));

      /* Citações */
      const statusCitacao = ["Pendente", "Encaminhada", "Resolvida"];
      await inserir("citacoes", aba.citacoes.filter((c) => idsInteracoes.has(txt(c.ID_Interacao, 40))).map((c) => ({
        id_citacao: txt(c.ID_Citacao, 40), id_ideia: txt(c.ID_Ideia, 40), id_interacao: txt(c.ID_Interacao, 40),
        apelido: txt(c.Apelido, 60).toLowerCase(), autor: txt(c.Autor, 120), trecho: txt(c.Trecho, 500),
        status: statusCitacao.includes(c.Status) ? c.Status : "Pendente",
        data: dataHora(c.Data) || agora, atualizado_em: dataHora(c.Atualizado_Em) || dataHora(c.Data) || agora
      })));

      /* Entregas (o documento ficou no Google Drive: precisa ser anexado de novo) */
      const entregas = aba.entregas.filter((e) => txt(e.ID_Entrega, 40) && idsIdeias.has(txt(e.ID_Ideia, 40)) && dataISO(e.Data_Entrega));
      const idsEntregas = new Set(entregas.map((e) => txt(e.ID_Entrega, 40)));
      await inserir("entregas", entregas.map((e) => {
        const s = STATUS_ENTREGA_ANTIGO[e.Status] || e.Status;
        return {
          id_entrega: txt(e.ID_Entrega, 40), id_ideia: txt(e.ID_Ideia, 40), data_entrega: dataISO(e.Data_Entrega),
          responsavel: txt(e.Responsavel, 120), comentarios: txt(e.Comentarios, 2000) || null,
          status: s === "Aprovado" ? "Aprovado" : "Aguardando análise",
          autor: txt(e.Autor, 120),
          data_criacao: dataHora(e.Data_Criacao) || agora, atualizado_em: dataHora(e.Atualizado_Em) || agora
        };
      }));
      entregas.filter((e) => txt(e.Anexo_ID, 200)).forEach((e) => {
        avisos.push(`Entrega ${txt(e.ID_Entrega, 40)} tinha o documento "${txt(e.Anexo_Nome, 200)}" no Google Drive: anexe de novo no sistema.`);
      });

      /* Encaminhamentos e vínculos com entregas */
      const statusEnc = ["Pendente", "Em Andamento", "Concluído", "Cancelado"];
      const encs = aba.encaminhamentos.filter((e) => txt(e.ID_Encaminhamento, 40) && idsIdeias.has(txt(e.ID_Ideia, 40)) && txt(e.Acao, 2000));
      await inserir("encaminhamentos", encs.map((e) => ({
        id_encaminhamento: txt(e.ID_Encaminhamento, 40), id_ideia: txt(e.ID_Ideia, 40), acao: txt(e.Acao, 2000),
        responsavel: txt(e.Responsavel, 120), prazo: dataISO(e.Prazo),
        status: statusEnc.includes(e.Status) ? e.Status : "Pendente",
        data_criacao: dataHora(e.Data_Criacao) || agora, atualizado_em: dataHora(e.Atualizado_Em) || agora
      })));
      await inserir("encaminhamento_entregas", encs.flatMap((e) =>
        [...new Set(String(e.ID_Entregas || "").split(",").map((x) => x.trim()).filter((x) => idsEntregas.has(x)))]
          .map((id_entrega) => ({ id_encaminhamento: txt(e.ID_Encaminhamento, 40), id_entrega }))));

      /* Metadados da IA */
      await inserir("recomendacoes_ia", aba.recomendacoes.filter((r) => txt(r.Titulo, 120) && txt(r.Texto, 2000)).map((r) => ({
        id_recomendacao: txt(r.ID_Recomendacao, 40), id_grupo: txt(r.ID_Grupo, 40) || null,
        titulo: txt(r.Titulo, 120), texto: txt(r.Texto, 2000), ativo: ativo(r.Ativo), autor: txt(r.Autor, 120),
        data_criacao: dataHora(r.Data_Criacao) || agora, atualizado_em: dataHora(r.Atualizado_Em) || agora
      })));
    });

    const contagem = await sequelize.query(
      `SELECT (SELECT COUNT(*) FROM grupos) grupos, (SELECT COUNT(*) FROM usuarios) usuarios, (SELECT COUNT(*) FROM ideias) pautas,
              (SELECT COUNT(*) FROM interacoes) interacoes, (SELECT COUNT(*) FROM curtidas) curtidas, (SELECT COUNT(*) FROM citacoes) citacoes,
              (SELECT COUNT(*) FROM encaminhamentos) encaminhamentos, (SELECT COUNT(*) FROM entregas) entregas,
              (SELECT COUNT(*) FROM encaminhamento_entregas) vinculos, (SELECT COUNT(*) FROM recomendacoes_ia) metadados_ia`,
      { type: QueryTypes.SELECT }
    );
    console.log("Importação concluída. No banco agora:");
    console.table(contagem[0]);
    if (avisos.length) console.log("Avisos:\n- " + avisos.join("\n- "));
  } finally {
    await sequelize.close();
  }
}

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith("--"));
if (!arquivo) {
  console.error("Uso: npm run importar -- caminho/da/planilha.xlsx [--substituir]");
  process.exit(1);
}
importar(arquivo, args.includes("--substituir")).catch((error) => {
  console.error("Erro na importação (nada foi gravado):", error.message);
  process.exit(1);
});
