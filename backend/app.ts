import express from "express";
import cors from "cors";
import rotas from "./src/routes";

const app = express();

// Atrás do gateway e do Nginx do frontend: o IP real vem em X-Forwarded-For
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api", rotas);

app.use((_req, res) => {
  res.status(404).json({ message: "Rota não encontrada." });
});

export default app;
