/**
 * Run this ONCE on your server:
 *   node run_migration.js
 *
 * It will add the missing columns to offline_messages and then exit.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const db = await mysql.createConnection({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT     || 3306,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset:  'utf8mb4',
  });

  console.log('✅ Connected to MySQL');

  try {
    // 1. Add visitor_id column
    await db.query(`
      ALTER TABLE offline_messages
        ADD COLUMN visitor_id INT NULL DEFAULT NULL AFTER business_id
    `);
    console.log('✅ Added column: visitor_id');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log('⚠️  visitor_id already exists — skipping');
    else throw e;
  }

  try {
    // 2. Add custom_fields column
    await db.query(`
      ALTER TABLE offline_messages
        ADD COLUMN custom_fields LONGTEXT NULL DEFAULT NULL AFTER message
    `);
    console.log('✅ Added column: custom_fields');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log('⚠️  custom_fields already exists — skipping');
    else throw e;
  }

  try {
    // 3. Add index
    await db.query(`
      ALTER TABLE offline_messages ADD INDEX idx_visitor_id (visitor_id)
    `);
    console.log('✅ Added index: idx_visitor_id');
  } catch (e) {
    if (e.code === 'ER_DUP_KEYNAME') console.log('⚠️  index already exists — skipping');
    else throw e;
  }

  // 4. Show current table structure
  const [cols] = await db.query('DESCRIBE offline_messages');
  console.log('\n📋 offline_messages columns now:');
  cols.forEach(c => console.log(`   ${c.Field} (${c.Type}) ${c.Null === 'YES' ? 'nullable' : 'NOT NULL'}`));

  // 5. Show existing rows to confirm email fallback will work
  const [rows] = await db.query(
    'SELECT id, visitor_id, email, LEFT(message,40) as msg, created_at FROM offline_messages ORDER BY created_at DESC LIMIT 5'
  );
  console.log('\n📋 Latest offline_messages rows:');
  console.table(rows);

  await db.end();
  console.log('\n✅ Migration complete. Now restart your Node server.');
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
