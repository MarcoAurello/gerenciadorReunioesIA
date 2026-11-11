import { DataTypes, Model, Sequelize } from "sequelize";

/*
 * Os atributos dos models usam os mesmos nomes que o frontend já recebia da
 * planilha (ID_Grupo, Nome...); no banco as colunas são snake_case ("field").
 */
class Grupo extends Model {
  declare ID_Grupo: string;
  declare Nome: string;
  declare Descricao: string;
  declare Ativo: boolean;
  declare Data_Criacao: Date;

  static initModel(sequelize: Sequelize) {
    Grupo.init(
      {
        ID_Grupo: { type: DataTypes.STRING(40), primaryKey: true, field: "id_grupo" },
        Nome: { type: DataTypes.STRING(80), allowNull: false, field: "nome" },
        Descricao: { type: DataTypes.STRING(500), allowNull: false, defaultValue: "", field: "descricao" },
        Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "ativo" },
        Data_Criacao: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "data_criacao" }
      },
      { sequelize, tableName: "grupos", timestamps: false }
    );
  }

  static associate(models: any) {
    Grupo.hasMany(models.Ideia, { foreignKey: "ID_Grupo", as: "ideias" });
    Grupo.hasMany(models.Recomendacao, { foreignKey: "ID_Grupo", as: "recomendacoes" });
  }
}

export default Grupo;
