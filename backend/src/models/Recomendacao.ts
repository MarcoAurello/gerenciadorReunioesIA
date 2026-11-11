import { DataTypes, Model, Sequelize } from "sequelize";

// Orientações que seguem para a IA junto com a discussão. ID_Grupo vazio = vale para todos os GTs.
class Recomendacao extends Model {
  declare ID_Recomendacao: string;
  declare ID_Grupo: string | null;
  declare Titulo: string;
  declare Texto: string;
  declare Ativo: boolean;
  declare Autor: string;
  declare Data_Criacao: Date;
  declare Atualizado_Em: Date;

  static initModel(sequelize: Sequelize) {
    Recomendacao.init(
      {
        ID_Recomendacao: { type: DataTypes.STRING(40), primaryKey: true, field: "id_recomendacao" },
        ID_Grupo: { type: DataTypes.STRING(40), allowNull: true, field: "id_grupo" },
        Titulo: { type: DataTypes.STRING(120), allowNull: false, field: "titulo" },
        Texto: { type: DataTypes.TEXT, allowNull: false, field: "texto" },
        Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "ativo" },
        Autor: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "autor" },
        Data_Criacao: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "data_criacao" },
        Atualizado_Em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "atualizado_em" }
      },
      { sequelize, tableName: "recomendacoes_ia", timestamps: false }
    );
  }

  static associate(models: any) {
    Recomendacao.belongsTo(models.Grupo, { foreignKey: "ID_Grupo", as: "grupo" });
  }
}

export default Recomendacao;
