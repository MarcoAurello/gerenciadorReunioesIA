import { DataTypes, Model, Sequelize } from "sequelize";

// Ideia = pauta do GT
class Ideia extends Model {
  declare ID_Ideia: string;
  declare ID_Grupo: string;
  declare Data_Criacao: Date;
  declare Titulo: string;
  declare Descricao: string;
  declare Status: "Em Debate" | "Em Redação" | "Aprovada" | "Arquivada";
  declare Autor: string;
  declare Atualizado_Em: Date;

  static initModel(sequelize: Sequelize) {
    Ideia.init(
      {
        ID_Ideia: { type: DataTypes.STRING(40), primaryKey: true, field: "id_ideia" },
        ID_Grupo: { type: DataTypes.STRING(40), allowNull: false, field: "id_grupo" },
        Data_Criacao: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "data_criacao" },
        Titulo: { type: DataTypes.STRING(200), allowNull: false, field: "titulo" },
        Descricao: { type: DataTypes.TEXT, allowNull: false, defaultValue: "", field: "descricao" },
        Status: {
          type: DataTypes.ENUM("Em Debate", "Em Redação", "Aprovada", "Arquivada"),
          allowNull: false, defaultValue: "Em Debate", field: "status"
        },
        Autor: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "autor" },
        Atualizado_Em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "atualizado_em" }
      },
      { sequelize, tableName: "ideias", timestamps: false }
    );
  }

  static associate(models: any) {
    Ideia.belongsTo(models.Grupo, { foreignKey: "ID_Grupo", as: "grupo" });
    Ideia.hasMany(models.Interacao, { foreignKey: "ID_Ideia", as: "interacoes" });
    Ideia.hasMany(models.Curtida, { foreignKey: "ID_Ideia", as: "curtidas" });
    Ideia.hasMany(models.Citacao, { foreignKey: "ID_Ideia", as: "citacoes" });
    Ideia.hasMany(models.Encaminhamento, { foreignKey: "ID_Ideia", as: "encaminhamentos" });
    Ideia.hasMany(models.Entrega, { foreignKey: "ID_Ideia", as: "entregas" });
  }
}

export default Ideia;
