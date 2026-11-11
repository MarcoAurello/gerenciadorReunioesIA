import express from "express";
import cors from "cors";
import rotas from "./src/routes";

const app = express();

// Atrás do gateway e do Nginx do frontend: o IP real vem em X-Forwarded-For
app.set("trust proxy", true);
app.use(cors());
// O frontend do protótipo manda JSON como text/plain (herança do Apps Script); aceita os dois
app.use(express.json({ limit: "15mb" }));
app.use(express.text({ type: "text/plain", limit: "15mb" }));

app.use("/api", rotas);

export default app;
