import { DataTypes, Model, Sequelize } from "sequelize";

class Encaminhamento extends Model {
  declare ID_Encaminhamento: string;
  declare ID_Ideia: string;
  declare Acao: string;
  declare Responsavel: string;
  declare Prazo: string | null; // yyyy-mm-dd
  declare Status: "Pendente" | "Em Andamento" | "Concluído" | "Cancelado";
  declare Data_Criacao: Date;
  declare Atualizado_Em: Date;

  static initModel(sequelize: Sequelize) {
    Encaminhamento.init(
      {
        ID_Encaminhamento: { type: DataTypes.STRING(40), primaryKey: true, field: "id_encaminhamento" },
        ID_Ideia: { type: DataTypes.STRING(40), allowNull: false, field: "id_ideia" },
        Acao: { type: DataTypes.TEXT, allowNull: false, field: "acao" },
        Responsavel: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "responsavel" },
        Prazo: { type: DataTypes.DATEONLY, allowNull: true, field: "prazo" },
        Status: {
          type: DataTypes.ENUM("Pendente", "Em Andamento", "Concluído", "Cancelado"),
          allowNull: false, defaultValue: "Pendente", field: "status"
        },
        Data_Criacao: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "data_criacao" },
        Atualizado_Em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "atualizado_em" }
      },
      { sequelize, tableName: "encaminhamentos", timestamps: false }
    );
  }

  static associate(models: any) {
    Encaminhamento.belongsTo(models.Ideia, { foreignKey: "ID_Ideia", as: "ideia" });
    Encaminhamento.belongsToMany(models.Entrega, {
      through: models.EncaminhamentoEntrega, foreignKey: "ID_Encaminhamento", otherKey: "ID_Entrega", as: "entregas"
    });
  }
}

export default Encaminhamento;
