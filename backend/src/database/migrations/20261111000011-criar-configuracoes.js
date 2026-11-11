"use strict";

// Configurações gravadas pela tela do administrador (ex.: chaves da IA, cifradas)
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("configuracoes", {
      chave: { type: Sequelize.STRING(60), primaryKey: true },
      valor: { type: Sequelize.TEXT, allowNull: true },
      atualizado_por: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "" },
      atualizado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("configuracoes");
  }
};
