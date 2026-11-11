"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ideias", {
      id_ideia: { type: Sequelize.STRING(40), primaryKey: true },
      id_grupo: {
        type: Sequelize.STRING(40), allowNull: false,
        references: { model: "grupos", key: "id_grupo" }, onUpdate: "CASCADE", onDelete: "RESTRICT"
      },
      data_criacao: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      titulo: { type: Sequelize.STRING(200), allowNull: false },
      descricao: { type: Sequelize.TEXT, allowNull: false },
      status: {
        type: Sequelize.ENUM("Em Debate", "Em Redação", "Aprovada", "Arquivada"),
        allowNull: false, defaultValue: "Em Debate"
      },
      autor: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "" },
      atualizado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
    await queryInterface.addIndex("ideias", ["id_grupo"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("ideias");
  }
};
