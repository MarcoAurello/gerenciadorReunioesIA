import { DataTypes, Model, Sequelize } from "sequelize";

// Configuração gravada pela tela do administrador; segredos ficam cifrados em "Valor"
class Configuracao extends Model {
  declare Chave: string;
  declare Valor: string | null;
  declare Atualizado_Por: string;
  declare Atualizado_Em: Date;

  static initModel(sequelize: Sequelize) {
    Configuracao.init(
      {
        Chave: { type: DataTypes.STRING(60), primaryKey: true, field: "chave" },
        Valor: { type: DataTypes.TEXT, allowNull: true, field: "valor" },
        Atualizado_Por: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "atualizado_por" },
        Atualizado_Em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "atualizado_em" }
      },
      { sequelize, tableName: "configuracoes", timestamps: false }
    );
  }

  static associate(_models: any) {}
}

export default Configuracao;
