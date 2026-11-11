"use strict";

// O GT-Sistemas existe sempre: pautas antigas sem grupo pertencem a ele
module.exports = {
  async up(queryInterface) {
    const [existe] = await queryInterface.sequelize.query("SELECT 1 FROM grupos WHERE id_grupo = 'GT-SISTEMAS'");
    if (existe.length) return;
    await queryInterface.bulkInsert("grupos", [
      { id_grupo: "GT-SISTEMAS", nome: "GT-Sistemas", descricao: "", ativo: true, data_criacao: new Date() }
    ]);
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete("grupos", { id_grupo: "GT-SISTEMAS" });
  }
};
