"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("encaminhamentos", {
      id_encaminhamento: { type: Sequelize.STRING(40), primaryKey: true },
      id_ideia: {
        type: Sequelize.STRING(40), allowNull: false,
        references: { model: "ideias", key: "id_ideia" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      acao: { type: Sequelize.TEXT, allowNull: false },
      responsavel: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "" },
      prazo: { type: Sequelize.DATEONLY, allowNull: true },
      status: {
        type: Sequelize.ENUM("Pendente", "Em Andamento", "Concluído", "Cancelado"),
        allowNull: false, defaultValue: "Pendente"
      },
      data_criacao: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      atualizado_em: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
    await queryInterface.addIndex("encaminhamentos", ["id_ideia"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("encaminhamentos");
  }
};
