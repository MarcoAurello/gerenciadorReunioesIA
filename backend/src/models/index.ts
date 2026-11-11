import { Sequelize, DataTypes, Model, ModelAttributes } from "sequelize";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dbConfig = require("../config/database");

const env = process.env.NODE_ENV || "development";
export const sequelize = new Sequelize(dbConfig[env]);

/*
 * Os atributos dos models usam os mesmos nomes que o frontend do protótipo já
 * recebia da planilha (ID_Ideia, Titulo, Data_Criacao...). No banco as colunas
 * são snake_case (campo "field"). Assim a API devolve o mesmo formato e o
 * frontend não muda.
 */
type Linha = Record<string, any>;
export class Registro extends Model<Linha, Linha> {}

function definir(nomeModel: string, tabela: string, atributos: ModelAttributes<Registro, Linha>) {
  return sequelize.define<Registro>(nomeModel, atributos, { tableName: tabela, timestamps: false });
}

const id = (field: string) => ({ type: DataTypes.STRING(40), primaryKey: true, field });
const ref = (field: string, allowNull = false) => ({ type: DataTypes.STRING(40), allowNull, field });
const agora = (field: string) => ({ type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field });

export const Grupo = definir("Grupo", "grupos", {
  ID_Grupo: id("id_grupo"),
  Nome: { type: DataTypes.STRING(80), allowNull: false, field: "nome" },
  Descricao: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "", field: "descricao" },
  Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "ativo" },
  Data_Criacao: agora("data_criacao")
});

export const Usuario = definir("Usuario", "usuarios", {
  ID_Usuario: id("id_usuario"),
  Nome: { type: DataTypes.STRING(120), allowNull: false, field: "nome" },
  Apelido: { type: DataTypes.STRING(60), allowNull: false, field: "apelido" },
  Email: { type: DataTypes.STRING(160), allowNull: true, field: "email" },
  Perfil: { type: DataTypes.ENUM("Administrador", "Colaborador", "Leitura"), allowNull: false, defaultValue: "Colaborador", field: "perfil" },
  Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "ativo" },
  Senha_Hash: { type: DataTypes.STRING(255), allowNull: true, field: "senha_hash" },
  Data_Criacao: agora("data_criacao")
});

export const Ideia = definir("Ideia", "ideias", {
  ID_Ideia: id("id_ideia"),
  ID_Grupo: ref("id_grupo"),
  Data_Criacao: agora("data_criacao"),
  Titulo: { type: DataTypes.STRING(200), allowNull: false, field: "titulo" },
  Descricao: { type: DataTypes.TEXT, allowNull: false, defaultValue: "", field: "descricao" },
  Status: { type: DataTypes.ENUM("Em Debate", "Em Redação", "Aprovada", "Arquivada"), allowNull: false, defaultValue: "Em Debate", field: "status" },
  Autor: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "autor" },
  Atualizado_Em: agora("atualizado_em")
});

export const Interacao = definir("Interacao", "interacoes", {
  ID_Interacao: id("id_interacao"),
  ID_Ideia: ref("id_ideia"),
  ID_Pai: ref("id_pai", true),
  Tipo: { type: DataTypes.ENUM("Comentário", "Sugestão"), allowNull: false, field: "tipo" },
  Autor: { type: DataTypes.STRING(120), allowNull: false, field: "autor" },
  Texto: { type: DataTypes.TEXT, allowNull: false, field: "texto" },
  Data: agora("data")
});

export const Curtida = definir("Curtida", "curtidas", {
  ID_Curtida: id("id_curtida"),
  ID_Ideia: ref("id_ideia"),
  ID_Interacao: ref("id_interacao"),
  Apelido: { type: DataTypes.STRING(60), allowNull: false, field: "apelido" },
  Nome: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "nome" },
  Data: agora("data")
});

export const Citacao = definir("Citacao", "citacoes", {
  ID_Citacao: id("id_citacao"),
  ID_Ideia: ref("id_ideia"),
  ID_Interacao: ref("id_interacao"),
  Apelido: { type: DataTypes.STRING(60), allowNull: false, field: "apelido" },
  Autor: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "autor" },
  Trecho: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "", field: "trecho" },
  Status: { type: DataTypes.ENUM("Pendente", "Encaminhada", "Resolvida"), allowNull: false, defaultValue: "Pendente", field: "status" },
  Data: agora("data"),
  Atualizado_Em: agora("atualizado_em")
});

export const Encaminhamento = definir("Encaminhamento", "encaminhamentos", {
  ID_Encaminhamento: id("id_encaminhamento"),
  ID_Ideia: ref("id_ideia"),
  Acao: { type: DataTypes.TEXT, allowNull: false, field: "acao" },
  Responsavel: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "responsavel" },
  Prazo: { type: DataTypes.DATEONLY, allowNull: true, field: "prazo" },
  Status: { type: DataTypes.ENUM("Pendente", "Em Andamento", "Concluído", "Cancelado"), allowNull: false, defaultValue: "Pendente", field: "status" },
  Data_Criacao: agora("data_criacao"),
  Atualizado_Em: agora("atualizado_em")
});

export const Entrega = definir("Entrega", "entregas", {
  ID_Entrega: id("id_entrega"),
  ID_Ideia: ref("id_ideia"),
  Data_Entrega: { type: DataTypes.DATEONLY, allowNull: false, field: "data_entrega" },
  Responsavel: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "responsavel" },
  Comentarios: { type: DataTypes.TEXT, allowNull: true, field: "comentarios" },
  Status: { type: DataTypes.ENUM("Aguardando análise", "Aprovado"), allowNull: false, defaultValue: "Aguardando análise", field: "status" },
  // Caminho do arquivo em src/uploads: nunca sai do servidor (o download passa pela API)
  Anexo_Arquivo: { type: DataTypes.STRING(255), allowNull: true, field: "anexo_arquivo" },
  Anexo_Nome: { type: DataTypes.STRING(255), allowNull: true, field: "anexo_nome" },
  Anexo_Tipo: { type: DataTypes.STRING(120), allowNull: true, field: "anexo_tipo" },
  Anexo_Tamanho: { type: DataTypes.INTEGER, allowNull: true, field: "anexo_tamanho" },
  Anexo_Por: { type: DataTypes.STRING(120), allowNull: true, field: "anexo_por" },
  Anexo_Em: { type: DataTypes.DATE, allowNull: true, field: "anexo_em" },
  Autor: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "autor" },
  Data_Criacao: agora("data_criacao"),
  Atualizado_Em: agora("atualizado_em")
});

export const EncaminhamentoEntrega = definir("EncaminhamentoEntrega", "encaminhamento_entregas", {
  ID_Encaminhamento: { type: DataTypes.STRING(40), primaryKey: true, field: "id_encaminhamento" },
  ID_Entrega: { type: DataTypes.STRING(40), primaryKey: true, field: "id_entrega" }
});

export const Recomendacao = definir("Recomendacao", "recomendacoes_ia", {
  ID_Recomendacao: id("id_recomendacao"),
  ID_Grupo: ref("id_grupo", true),
  Titulo: { type: DataTypes.STRING(120), allowNull: false, field: "titulo" },
  Texto: { type: DataTypes.TEXT, allowNull: false, field: "texto" },
  Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "ativo" },
  Autor: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "autor" },
  Data_Criacao: agora("data_criacao"),
  Atualizado_Em: agora("atualizado_em")
});

/* Associações */
Grupo.hasMany(Ideia, { foreignKey: "ID_Grupo", as: "ideias" });
Ideia.belongsTo(Grupo, { foreignKey: "ID_Grupo", as: "grupo" });

Ideia.hasMany(Interacao, { foreignKey: "ID_Ideia", as: "interacoes" });
Ideia.hasMany(Curtida, { foreignKey: "ID_Ideia", as: "curtidas" });
Ideia.hasMany(Citacao, { foreignKey: "ID_Ideia", as: "citacoes" });
Ideia.hasMany(Encaminhamento, { foreignKey: "ID_Ideia", as: "encaminhamentos" });
Ideia.hasMany(Entrega, { foreignKey: "ID_Ideia", as: "entregas" });

Interacao.belongsTo(Ideia, { foreignKey: "ID_Ideia", as: "ideia" });
Interacao.hasMany(Interacao, { foreignKey: "ID_Pai", as: "comentarios" });
Interacao.belongsTo(Interacao, { foreignKey: "ID_Pai", as: "pai" });
Interacao.hasMany(Curtida, { foreignKey: "ID_Interacao", as: "curtidas" });

Encaminhamento.belongsToMany(Entrega, { through: EncaminhamentoEntrega, foreignKey: "ID_Encaminhamento", otherKey: "ID_Entrega", as: "entregas" });
Entrega.belongsToMany(Encaminhamento, { through: EncaminhamentoEntrega, foreignKey: "ID_Entrega", otherKey: "ID_Encaminhamento", as: "encaminhamentos" });

Grupo.hasMany(Recomendacao, { foreignKey: "ID_Grupo", as: "recomendacoes" });
