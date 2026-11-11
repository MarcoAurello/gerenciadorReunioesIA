import "dotenv/config";
import app from "./app";
import { sequelize } from "./src/models";

const PORTA = Number(process.env.PORT || 3333);

async function iniciar() {
  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET não configurado no .env.");
    process.exit(1);
  }
  try {
    await sequelize.authenticate();
    console.log("Banco de dados conectado.");
  } catch (error) {
    console.error("Erro ao conectar ao banco de dados:", error);
    process.exit(1);
  }
  app.listen(PORTA, () => console.log(`API do Sistema de Apoio a Reuniões na porta ${PORTA}.`));
}

iniciar();
