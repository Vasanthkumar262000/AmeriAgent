// Notifications routes — add these inside routes/business.js or a new file
// These go inside the business router

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');

// ─── GET NOTIFICATIONS ────────────────────────────────────────────────────────
// Called by Dashboard every 30 seconds
router.get('/notifications', authMiddleware(['business']), async (req, res) => {
  const business_id = req.user.id;
  try {
    // Auto-generate plan expiry notifications if needed
    await generateExpiryNotifications(business_id);

    const [rows] = await db.query(
      `SELECT * FROM business_notifications
       WHERE business_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [business_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Notifications error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── MARK ONE READ ────────────────────────────────────────────────────────────
router.put('/notifications/:id/read', authMiddleware(['business']), async (req, res) => {
  try {
    await db.query(
      'UPDATE business_notifications SET is_read = 1 WHERE id = ? AND business_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── MARK ALL READ ────────────────────────────────────────────────────────────
router.put('/notifications/read-all', authMiddleware(['business']), async (req, res) => {
  try {
    await db.query(
      'UPDATE business_notifications SET is_read = 1 WHERE business_id = ?',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── HELPER: Auto-create expiry notifications ─────────────────────────────────
async function generateExpiryNotifications(business_id) {
  try {
    const [[biz]] = await db.query(
      'SELECT plan_expires_at, plan_key FROM businesses WHERE id = ?',
      [business_id]
    );
    if (!biz?.plan_expires_at) return;

    const daysLeft = Math.ceil((new Date(biz.plan_expires_at) - new Date()) / (1000 * 60 * 60 * 24));

    // 7-day warning
    if (daysLeft === 7 || daysLeft === 3 || daysLeft === 1) {
      const type = daysLeft <= 0 ? 'plan_expired' : 'plan_expiring';
      const title = daysLeft <= 0 ? 'Plan Expired' : `Plan Expires in ${daysLeft} Day${daysLeft > 1 ? 's' : ''}`;
      const message = daysLeft <= 0
        ? 'Your plan has expired. Renew now to restore access.'
        : `Your plan will expire on ${new Date(biz.plan_expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Renew to avoid interruption.`;

      // Check if already created today
      const [[existing]] = await db.query(
        `SELECT id FROM business_notifications
         WHERE business_id = ? AND type = ? AND DATE(created_at) = CURDATE()`,
        [business_id, type]
      );
      if (!existing) {
        await db.query(
          'INSERT INTO business_notifications (business_id, type, title, message) VALUES (?,?,?,?)',
          [business_id, type, title, message]
        );
      }
    }
  } catch (e) {}
}

module.exports = router;
