"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("citacoes", {
      id_citacao: { type: Sequelize.STRING(40), primaryKey: true },
      id_ideia: {
        type: Sequelize.STRING(40), allowNull: false,
        references: { model: "ideias", key: "id_ideia" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      id_interacao: {
        type: Sequelize.STRING(40), allowNull: false,
        references: { model: "interacoes", key: "id_interacao" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      apelido: { type: Sequelize.STRING(60), allowNull: false },
      autor: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "" },
      trecho: { type: Sequelize.STRING(500), allowNull: false, defaultValue: "" },
      status: { type: Sequelize.ENUM("Pendente", "Encaminhada", "Resolvida"), allowNull: false, defaultValue: "Pendente" },
      data: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      atualizado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
    await queryInterface.addIndex("citacoes", ["apelido"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("citacoes");
  }
};
