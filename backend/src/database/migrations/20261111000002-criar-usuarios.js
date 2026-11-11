"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("usuarios", {
      id_usuario: { type: Sequelize.STRING(40), primaryKey: true },
      nome: { type: Sequelize.STRING(120), allowNull: false },
      apelido: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      email: { type: Sequelize.STRING(160), allowNull: true },
      perfil: { type: Sequelize.ENUM("Administrador", "Colaborador", "Leitura"), allowNull: false, defaultValue: "Colaborador" },
      ativo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      // bcrypt; usuários importados da planilha guardam o hash antigo ("salt$sha256") até o próximo login
      senha_hash: { type: Sequelize.STRING(255), allowNull: true },
      data_criacao: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") }
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("usuarios");
  }
};
