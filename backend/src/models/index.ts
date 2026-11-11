import { Sequelize } from "sequelize";
import Grupo from "./Grupo";
import Usuario from "./Usuario";
import Ideia from "./Ideia";
import Interacao from "./Interacao";
import Curtida from "./Curtida";
import Citacao from "./Citacao";
import Encaminhamento from "./Encaminhamento";
import Entrega from "./Entrega";
import EncaminhamentoEntrega from "./EncaminhamentoEntrega";
import Recomendacao from "./Recomendacao";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dbConfig = require("../config/database");

const env = process.env.NODE_ENV || "development";
export const sequelize = new Sequelize(dbConfig[env]);

const models = {
  Grupo, Usuario, Ideia, Interacao, Curtida, Citacao, Encaminhamento, Entrega, EncaminhamentoEntrega, Recomendacao
};

Object.values(models).forEach((m) => m.initModel(sequelize));
Object.values(models).forEach((m) => m.associate(models));

export {
  Grupo, Usuario, Ideia, Interacao, Curtida, Citacao, Encaminhamento, Entrega, EncaminhamentoEntrega, Recomendacao
};
