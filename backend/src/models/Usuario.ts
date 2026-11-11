import { DataTypes, Model, Sequelize } from "sequelize";

class Usuario extends Model {
  declare ID_Usuario: string;
  declare Nome: string;
  declare Apelido: string;
  declare Email: string | null;
  declare Perfil: "Administrador" | "Colaborador" | "Leitura";
  declare Ativo: boolean;
  declare Senha_Hash: string | null;
  declare Data_Criacao: Date;

  static initModel(sequelize: Sequelize) {
    Usuario.init(
      {
        ID_Usuario: { type: DataTypes.STRING(40), primaryKey: true, field: "id_usuario" },
        Nome: { type: DataTypes.STRING(120), allowNull: false, field: "nome" },
        Apelido: { type: DataTypes.STRING(60), allowNull: false, field: "apelido" },
        Email: { type: DataTypes.STRING(160), allowNull: true, field: "email" },
        Perfil: {
          type: DataTypes.ENUM("Administrador", "Colaborador", "Leitura"),
          allowNull: false, defaultValue: "Colaborador", field: "perfil"
        },
        Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "ativo" },
        Senha_Hash: { type: DataTypes.STRING(255), allowNull: true, field: "senha_hash" },
        Data_Criacao: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "data_criacao" }
      },
      { sequelize, tableName: "usuarios", timestamps: false }
    );
  }

  static associate(_models: any) {}
}

export default Usuario;
