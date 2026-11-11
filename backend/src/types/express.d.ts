import { Sessao } from "../lib/constantes";

declare global {
  namespace Express {
    interface Request {
      sessao?: Sessao;
    }
  }
}

export {};
