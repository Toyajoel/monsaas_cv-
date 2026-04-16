import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.TIDB_HOST,
  port: process.env.TIDB_PORT || 4000,
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE || 'cv',
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function initDB() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connecté à TiDB Cloud');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        phoneNumber VARCHAR(20) PRIMARY KEY,
        credits INT DEFAULT 0,
        lastPayment TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(100) PRIMARY KEY,
        phoneNumber VARCHAR(20),
        amount INT,
        status VARCHAR(20),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    connection.release();
    console.log('✅ Tables initialisées');
  } catch (error) {
    console.error('❌ Erreur initialisation TiDB:', error.message);
  }
}

initDB(); // Création automatique des tables au démarrage

export default pool;
