const mysql = require('mysql2/promise');
require('dotenv').config();
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  collation: 'utf8mb4_unicode_ci',
  dateStrings: true,    // ← FIXED: prevents Date objects from crashing JSON serialization
});
pool.getConnection()
  .then(async conn => {
    await conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    await conn.query("SET CHARACTER SET utf8mb4");
    console.log('✅ MySQL connected successfully');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL connection failed:', err.message);
  });
module.exports = pool;