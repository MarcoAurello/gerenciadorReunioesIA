"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("entregas", {
      id_entrega: { type: Sequelize.STRING(40), primaryKey: true },
      id_ideia: {
        type: Sequelize.STRING(40), allowNull: false,
        references: { model: "ideias", key: "id_ideia" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      data_entrega: { type: Sequelize.DATEONLY, allowNull: false },
      responsavel: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "" },
      comentarios: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.ENUM("Aguardando análise", "Aprovado"), allowNull: false, defaultValue: "Aguardando análise" },
      // Documento anexado: arquivo em src/uploads (no protótipo, um arquivo do Google Drive)
      anexo_arquivo: { type: Sequelize.STRING(255), allowNull: true },
      anexo_nome: { type: Sequelize.STRING(255), allowNull: true },
      anexo_tipo: { type: Sequelize.STRING(120), allowNull: true },
      anexo_tamanho: { type: Sequelize.INTEGER, allowNull: true },
      anexo_por: { type: Sequelize.STRING(120), allowNull: true },
      anexo_em: { type: Sequelize.DATE, allowNull: true },
      autor: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "" },
      data_criacao: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      atualizado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
    await queryInterface.addIndex("entregas", ["id_ideia"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("entregas");
  }
};
