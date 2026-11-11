import { DataTypes, Model, Sequelize } from "sequelize";

// Sugestão (sem ID_Pai) ou comentário de uma sugestão (com ID_Pai)
class Interacao extends Model {
  declare ID_Interacao: string;
  declare ID_Ideia: string;
  declare ID_Pai: string | null;
  declare Tipo: "Comentário" | "Sugestão";
  declare Autor: string;
  declare Texto: string;
  declare Data: Date;

  static initModel(sequelize: Sequelize) {
    Interacao.init(
      {
        ID_Interacao: { type: DataTypes.STRING(40), primaryKey: true, field: "id_interacao" },
        ID_Ideia: { type: DataTypes.STRING(40), allowNull: false, field: "id_ideia" },
        ID_Pai: { type: DataTypes.STRING(40), allowNull: true, field: "id_pai" },
        Tipo: { type: DataTypes.ENUM("Comentário", "Sugestão"), allowNull: false, field: "tipo" },
        Autor: { type: DataTypes.STRING(120), allowNull: false, field: "autor" },
        Texto: { type: DataTypes.TEXT, allowNull: false, field: "texto" },
        Data: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "data" }
      },
      { sequelize, tableName: "interacoes", timestamps: false }
    );
  }

  static associate(models: any) {
    Interacao.belongsTo(models.Ideia, { foreignKey: "ID_Ideia", as: "ideia" });
    Interacao.belongsTo(Interacao, { foreignKey: "ID_Pai", as: "pai" });
    Interacao.hasMany(Interacao, { foreignKey: "ID_Pai", as: "comentarios" });
    Interacao.hasMany(models.Curtida, { foreignKey: "ID_Interacao", as: "curtidas" });
    Interacao.hasMany(models.Citacao, { foreignKey: "ID_Interacao", as: "citacoes" });
  }
}

export default Interacao;
