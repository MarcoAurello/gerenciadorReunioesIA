import { DataTypes, Model, Sequelize } from "sequelize";

// Entrega prevista de uma pauta, com um documento anexado opcional
class Entrega extends Model {
  declare ID_Entrega: string;
  declare ID_Ideia: string;
  declare Data_Entrega: string; // yyyy-mm-dd
  declare Responsavel: string;
  declare Comentarios: string | null;
  declare Status: "Aguardando análise" | "Aprovado";
  declare Anexo_Arquivo: string | null;
  declare Anexo_Nome: string | null;
  declare Anexo_Tipo: string | null;
  declare Anexo_Tamanho: number | null;
  declare Anexo_Por: string | null;
  declare Anexo_Em: Date | null;
  declare Autor: string;
  declare Data_Criacao: Date;
  declare Atualizado_Em: Date;

  static initModel(sequelize: Sequelize) {
    Entrega.init(
      {
        ID_Entrega: { type: DataTypes.STRING(40), primaryKey: true, field: "id_entrega" },
        ID_Ideia: { type: DataTypes.STRING(40), allowNull: false, field: "id_ideia" },
        Data_Entrega: { type: DataTypes.DATEONLY, allowNull: false, field: "data_entrega" },
        Responsavel: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "responsavel" },
        Comentarios: { type: DataTypes.TEXT, allowNull: true, field: "comentarios" },
        Status: {
          type: DataTypes.ENUM("Aguardando análise", "Aprovado"),
          allowNull: false, defaultValue: "Aguardando análise", field: "status"
        },
        // Caminho do arquivo em src/uploads: nunca sai do servidor (o download passa pela API)
        Anexo_Arquivo: { type: DataTypes.STRING(255), allowNull: true, field: "anexo_arquivo" },
        Anexo_Nome: { type: DataTypes.STRING(255), allowNull: true, field: "anexo_nome" },
        Anexo_Tipo: { type: DataTypes.STRING(120), allowNull: true, field: "anexo_tipo" },
        Anexo_Tamanho: { type: DataTypes.INTEGER, allowNull: true, field: "anexo_tamanho" },
        Anexo_Por: { type: DataTypes.STRING(120), allowNull: true, field: "anexo_por" },
        Anexo_Em: { type: DataTypes.DATE, allowNull: true, field: "anexo_em" },
        Autor: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "", field: "autor" },
        Data_Criacao: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "data_criacao" },
        Atualizado_Em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: "atualizado_em" }
      },
      { sequelize, tableName: "entregas", timestamps: false }
    );
  }

  static associate(models: any) {
    Entrega.belongsTo(models.Ideia, { foreignKey: "ID_Ideia", as: "ideia" });
    Entrega.belongsToMany(models.Encaminhamento, {
      through: models.EncaminhamentoEntrega, foreignKey: "ID_Entrega", otherKey: "ID_Encaminhamento", as: "encaminhamentos"
    });
  }
}

export default Entrega;
