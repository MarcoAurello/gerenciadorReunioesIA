import { DataTypes, Model, Sequelize } from "sequelize";

// Uma curtida por usuário em cada sugestão
class Curtida extends Model {
  declare ID_Curtida: string;
  declare ID_Ideia: string;
  declare ID_Interacao: string;
  declare Apelido: string;
  declare Nome: string;
  declare Data: Date;

  static initModel(sequelize: Sequelize) {
    Curtida.init(
      {
        ID_Curtida: { type: DataTypes.STRING(40), primaryKey: true, field: "id_curtida" },
        ID_Ideia: { type: DataTypes.STRING(40), allowNull: false, field: "id_ideia" },
        ID_Interacao: { type: DataTypes.STRING(40), allowNull: false, field: "id_interacao" },
        Apelido: { type: DataTypes.STRING(60), allowNull: false, field: "apelido" },
        Nome: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "nome" },
        Data: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "data" }
      },
      { sequelize, tableName: "curtidas", timestamps: false }
    );
  }

  static associate(models: any) {
    Curtida.belongsTo(models.Interacao, { foreignKey: "ID_Interacao", as: "sugestao" });
  }
}

export default Curtida;
