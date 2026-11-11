"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("grupos", {
      id_grupo: { type: Sequelize.STRING(40), primaryKey: true },
      nome: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      descricao: { type: Sequelize.STRING(500), allowNull: false, defaultValue: "" },
      ativo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      data_criacao: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("grupos");
  }
};
