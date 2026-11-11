// Usado pelo app e pelo sequelize-cli (por isso em CommonJS)
require("dotenv").config();

const base = {
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  dialect: "mysql",
  timezone: "-03:00",
  logging: false,
  define: { timestamps: false, underscored: true, freezeTableName: true }
};

module.exports = { development: base, test: base, production: base };
