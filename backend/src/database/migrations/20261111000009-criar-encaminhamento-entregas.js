"use strict";

// Entregas vinculadas a cada encaminhamento (na planilha: IDs separados por vírgula em ID_Entregas)
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("encaminhamento_entregas", {
      id_encaminhamento: {
        type: Sequelize.STRING(40), primaryKey: true,
        references: { model: "encaminhamentos", key: "id_encaminhamento" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      id_entrega: {
        type: Sequelize.STRING(40), primaryKey: true,
        references: { model: "entregas", key: "id_entrega" }, onUpdate: "CASCADE", onDelete: "CASCADE"
      }
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("encaminhamento_entregas");
  }
};
