/**
 * MSChat - Super Admin Setup Script
 * Run this ONCE after importing the database schema
 * Usage: node setup-admin.js
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function setup() {
  console.log('🚀 MSChat Super Admin Setup');
  console.log('================================\n');

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'mschat',
    user: process.env.DB_USER || 'mschat_admin',
    password: process.env.DB_PASSWORD
  });

  try {
    // Check if super admin already exists
    const [existing] = await db.query('SELECT id FROM super_admins WHERE email = ?', ['halo@msdiscoveries.com']);
    if (existing.length) {
      console.log('⚠️  Super admin already exists. Skipping creation.');
      console.log('   Email: halo@msdiscoveries.com');
      await db.end();
      return;
    }

    // Create super admin
    const password = 'MSChat@Admin2025!'; // Change this after first login
    const hash = await bcrypt.hash(password, 12);

    await db.query(
      'INSERT INTO super_admins (name, email, password_hash) VALUES (?, ?, ?)',
      ['MS Discoveries Admin', 'halo@msdiscoveries.com', hash]
    );

    console.log('✅ Super Admin created successfully!\n');
    console.log('📋 Login Credentials:');
    console.log('   URL:      https://mschat.msdiscoveries.com/login');
    console.log('   Tab:      Admin');
    console.log('   Email:    halo@msdiscoveries.com');
    console.log('   Password: MSChat@Admin2025!\n');
    console.log('⚠️  IMPORTANT: Change your password after first login!\n');

    // Verify plan settings exist
    const [plans] = await db.query('SELECT COUNT(*) as c FROM plan_settings');
    if (plans[0].c === 0) {
      console.log('⚠️  No plan settings found. Please import schema.sql first.');
    } else {
      console.log(`✅ ${plans[0].c} plans configured in database`);
    }

    await db.end();
    console.log('\n🎉 MSChat is ready to use!');
    console.log('   Frontend: https://mschat.msdiscoveries.com');
    console.log('   Backend:  https://api.mschat.msdiscoveries.com');
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    await db.end();
    process.exit(1);
  }
}

setup();
