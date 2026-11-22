/**
 * MSChat — MS Discoveries Own Account Setup
 * 
 * This creates the MS Discoveries business account so their
 * chat widget appears on mschat.msdiscoveries.com
 * 
 * Run AFTER setup-admin.js
 * Usage: node setup-msdiscoveries-account.js
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const BOT_ID = 'MSDISCOVERIES_BOT_ID'; // Fixed ID used in index.html

async function setup() {
  console.log('🚀 Setting up MS Discoveries own chatbot account...\n');

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'mschat',
    user: process.env.DB_USER || 'mschat_admin',
    password: process.env.DB_PASSWORD
  });

  try {
    // Check if already exists
    const [existing] = await db.query('SELECT id FROM businesses WHERE bot_id = ?', [BOT_ID]);
    if (existing.length) {
      console.log('⚠️  MS Discoveries account already exists.');
      console.log(`   Bot ID: ${BOT_ID}`);
      await db.end();
      return;
    }

    const password_hash = await bcrypt.hash('MSDiscoveries@2025!', 12);

    // Create business account for MS Discoveries (pack_advanced, permanently active)
    const [result] = await db.query(
      `INSERT INTO businesses
        (company_name, owner_name, email, phone, password_hash,
         plan_key, billing_cycle, currency, account_status, payment_status,
         bot_id, welcome_message, offline_message, widget_position,
         greeting_enabled, greeting_delay_seconds, auto_greeting_message,
         plan_started_at, plan_expires_at, chats_used_this_month, month_reset_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(),
               DATE_ADD(NOW(), INTERVAL 100 YEAR), 0, DATE_ADD(CURDATE(), INTERVAL 1 MONTH))`,
      [
        'MS Discoveries',
        'MS Discoveries Team',
        'halo@msdiscoveries.com',
        '9443724724',
        password_hash,
        'pack_advanced',
        'yearly',
        'inr',
        'active',      // already active — no payment needed
        'paid',
        BOT_ID,
        'Hi! Welcome to MSChat by MS Discoveries. How can we help you today?',
        'We are currently offline. Please email us at halo@msdiscoveries.com or call +91 9443724724.',
        'bottom_right',
        1,   // greeting enabled
        6,   // 6 seconds delay
        '👋 Hello! Interested in adding a chatbot to your website? We\'re here to help!'
      ]
    );

    const businessId = result.insertId;

    // Create branding for MS Discoveries
    await db.query(
      `INSERT INTO business_branding
        (business_id, company_display_name, brand_color, show_powered_by, logo_url)
       VALUES (?, ?, ?, ?, ?)`,
      [businessId, 'MS Discoveries', '#00d55b', 0, ''] // show_powered_by = 0 (pack advanced)
    );

    // Create main agent for MS Discoveries (the support team)
    const agentHash = await bcrypt.hash('MSAgent@2025!', 12);
    await db.query(
      `INSERT INTO agents (business_id, name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [businessId, 'MS Discoveries Support', 'halo@msdiscoveries.com', agentHash, 'main_agent', 1]
    );

    console.log('✅ MS Discoveries chatbot account created!\n');
    console.log('📋 Details:');
    console.log(`   Bot ID:        ${BOT_ID}`);
    console.log(`   Business ID:   ${businessId}`);
    console.log(`   Plan:          Pack Advanced (permanent)`);
    console.log(`   Widget on:     mschat.msdiscoveries.com\n`);
    console.log('📋 Agent Login:');
    console.log('   URL:           https://mschat.msdiscoveries.com/login → Agent tab');
    console.log('   Email:         halo@msdiscoveries.com');
    console.log('   Password:      MSAgent@2025!\n');
    console.log('⚠️  Change the agent password after first login!\n');
    console.log('✅ The chat widget will now appear on mschat.msdiscoveries.com');
    console.log('   Visitors can chat with your team directly on the website!');

    await db.end();
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    await db.end();
    process.exit(1);
  }
}

setup();
