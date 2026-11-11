import { DataTypes, Model, Sequelize } from "sequelize";

// Entregas vinculadas a cada encaminhamento
class EncaminhamentoEntrega extends Model {
  declare ID_Encaminhamento: string;
  declare ID_Entrega: string;

  static initModel(sequelize: Sequelize) {
    EncaminhamentoEntrega.init(
      {
        ID_Encaminhamento: { type: DataTypes.STRING(40), primaryKey: true, field: "id_encaminhamento" },
        ID_Entrega: { type: DataTypes.STRING(40), primaryKey: true, field: "id_entrega" }
      },
      { sequelize, tableName: "encaminhamento_entregas", timestamps: false }
    );
  }

  static associate(_models: any) {}
}

export default EncaminhamentoEntrega;
