const db = require('../config/db');

// Run every hour
setInterval(async () => {
  try {
    // Suspend accounts where plan has expired
    const [r1] = await db.query(
      `UPDATE businesses 
       SET account_status = 'suspended', suspended_at = NOW()
       WHERE account_status = 'active'
       AND plan_expires_at IS NOT NULL
       AND plan_expires_at < NOW()`
    );
    if (r1.affectedRows > 0) console.log(`Auto-suspended ${r1.affectedRows} expired accounts`);
  } catch(e) {
    console.error('Cron suspend error:', e.message);
  }
}, 60 * 60 * 1000);

// Auto-move unanswered chats to missed after 5 minutes
setInterval(async () => {
  try {
    const [result] = await db.query(
      `UPDATE chats SET status = 'missed'
       WHERE status = 'open'
       AND first_response_at IS NULL
       AND started_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`
    );
    if (result.affectedRows > 0) {
      console.log(`Auto-missed ${result.affectedRows} unanswered chats`);
    }
  } catch(e) { console.error('Auto-miss error:', e.message); }
}, 60 * 1000); // Check every minute

console.log('Cron jobs started');