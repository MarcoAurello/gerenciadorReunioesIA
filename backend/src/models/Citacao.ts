import { DataTypes, Model, Sequelize } from "sequelize";

// @apelido citado em uma sugestão ou comentário
class Citacao extends Model {
  declare ID_Citacao: string;
  declare ID_Ideia: string;
  declare ID_Interacao: string;
  declare Apelido: string;
  declare Autor: string;
  declare Trecho: string;
  declare Status: "Pendente" | "Encaminhada" | "Resolvida";
  declare Data: Date;
  declare Atualizado_Em: Date;

  static initModel(sequelize: Sequelize) {
    Citacao.init(
      {
        ID_Citacao: { type: DataTypes.STRING(40), primaryKey: true, field: "id_citacao" },
        ID_Ideia: { type: DataTypes.STRING(40), allowNull: false, field: "id_ideia" },
        ID_Interacao: { type: DataTypes.STRING(40), allowNull: false, field: "id_interacao" },
        Apelido: { type: DataTypes.STRING(60), allowNull: false, field: "apelido" },
        Autor: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "autor" },
        Trecho: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "", field: "trecho" },
        Status: {
          type: DataTypes.ENUM("Pendente", "Encaminhada", "Resolvida"),
          allowNull: false, defaultValue: "Pendente", field: "status"
        },
        Data: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "data" },
        Atualizado_Em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "atualizado_em" }
      },
      { sequelize, tableName: "citacoes", timestamps: false }
    );
  }

  static associate(models: any) {
    Citacao.belongsTo(models.Ideia, { foreignKey: "ID_Ideia", as: "ideia" });
    Citacao.belongsTo(models.Interacao, { foreignKey: "ID_Interacao", as: "interacao" });
  }
}

export default Citacao;
