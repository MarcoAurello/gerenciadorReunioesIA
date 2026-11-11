import "dotenv/config";

// O protótipo mantinha a sessão por 6 h; o frontend não renova token, então o padrão segue igual.
export default {
  secret: process.env.JWT_SECRET as string,
  expiresIn: process.env.JWT_EXPIRES_IN || "6h",
  // Primeiro acesso e observador, como nas Propriedades do script do protótipo
  senhaAdmin: process.env.SENHA_ADMIN || "",
  senhaLeitura: process.env.SENHA_LEITURA || "",
  maxTentativas: 5,
  bloqueioSegundos: 10 * 60
};
