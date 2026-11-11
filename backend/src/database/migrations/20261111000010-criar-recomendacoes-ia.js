"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("recomendacoes_ia", {
      id_recomendacao: { type: Sequelize.STRING(40), primaryKey: true },
      // Vazio = vale para todos os GTs
      id_grupo: {
        type: Sequelize.STRING(40), allowNull: true,
        references: { model: "grupos", key: "id_grupo" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      titulo: { type: Sequelize.STRING(120), allowNull: false },
      texto: { type: Sequelize.TEXT, allowNull: false },
      ativo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      autor: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "" },
      data_criacao: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      atualizado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("recomendacoes_ia");
  }
};
