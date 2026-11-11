"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("curtidas", {
      id_curtida: { type: Sequelize.STRING(40), primaryKey: true },
      id_ideia: {
        type: Sequelize.STRING(40), allowNull: false,
        references: { model: "ideias", key: "id_ideia" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      id_interacao: {
        type: Sequelize.STRING(40), allowNull: false,
        references: { model: "interacoes", key: "id_interacao" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      apelido: { type: Sequelize.STRING(60), allowNull: false },
      nome: { type: Sequelize.STRING(120), allowNull: false, defaultValue: "" },
      data: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
    // Uma curtida por usuário em cada sugestão
    await queryInterface.addIndex("curtidas", ["id_interacao", "apelido"], { unique: true });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("curtidas");
  }
};
