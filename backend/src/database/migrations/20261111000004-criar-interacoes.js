"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("interacoes", {
      id_interacao: { type: Sequelize.STRING(40), primaryKey: true },
      id_ideia: {
        type: Sequelize.STRING(40), allowNull: false,
        references: { model: "ideias", key: "id_ideia" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      // Vazio = sugestão (ou comentário avulso antigo); preenchido = comentário daquela sugestão
      id_pai: {
        type: Sequelize.STRING(40), allowNull: true,
        references: { model: "interacoes", key: "id_interacao" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      tipo: { type: Sequelize.ENUM("Comentário", "Sugestão"), allowNull: false },
      autor: { type: Sequelize.STRING(120), allowNull: false },
      texto: { type: Sequelize.TEXT, allowNull: false },
      data: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
    await queryInterface.addIndex("interacoes", ["id_ideia"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("interacoes");
  }
};
