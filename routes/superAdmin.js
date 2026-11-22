const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');

// ─── STATS ────────────────────────────────────────────────────────────────────
router.get('/stats', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const [[total]] = await db.query('SELECT COUNT(*) as c FROM businesses WHERE account_status != "deleted"');
    const [[active]] = await db.query('SELECT COUNT(*) as c FROM businesses WHERE account_status = "active"');
    const [[suspended]] = await db.query('SELECT COUNT(*) as c FROM businesses WHERE account_status = "suspended"');
    const [[pack_one]] = await db.query('SELECT COUNT(*) as c FROM businesses WHERE plan_key = "pack_one" AND account_status = "active"');
    const [[pack_two]] = await db.query('SELECT COUNT(*) as c FROM businesses WHERE plan_key = "pack_two" AND account_status = "active"');
    const [[pack_advanced]] = await db.query('SELECT COUNT(*) as c FROM businesses WHERE plan_key = "pack_advanced" AND account_status = "active"');

    res.json({ success: true, data: {
      total_businesses: total.c, active_businesses: active.c,
      suspended_businesses: suspended.c, pack_one: pack_one.c,
      pack_two: pack_two.c, pack_advanced: pack_advanced.c
    }});
  } catch (err) {
    res.status(500).json({ success: false, message: 'Stats failed' });
  }
});

// ─── ALL BUSINESSES ───────────────────────────────────────────────────────────
router.get('/businesses', authMiddleware(['super_admin']), async (req, res) => {
  const { limit = 200, status } = req.query;
  try {
    let q = `SELECT b.id, b.company_name, b.owner_name, b.email, b.phone,
             b.plan_key, b.billing_cycle, b.currency, b.account_status,
             b.payment_status, b.bot_id, b.plan_started_at, b.plan_expires_at,
             b.chats_used_this_month, b.created_at,
             COALESCE(ps.plan_name, b.plan_key) as plan_name
             FROM businesses b
             LEFT JOIN plan_settings ps ON b.plan_key = ps.plan_key
             WHERE 1=1`;
    const params = [];
    if (status && status !== 'all') { q += ' AND b.account_status = ?'; params.push(status); }
    q += ' ORDER BY b.created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    const [rows] = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Businesses fetch error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── UPDATE BUSINESS STATUS ───────────────────────────────────────────────────
router.put('/businesses/:id/status', authMiddleware(['super_admin']), async (req, res) => {
  const { status } = req.body;
  await db.query("UPDATE businesses SET account_status = ?, suspended_at = IF(? = 'suspended', NOW(), NULL) WHERE id = ?", [status, status, req.params.id]);
  res.json({ success: true, message: 'Status updated' });
});

// ─── GET ALL PLANS (for admin to edit) ────────────────────────────────────────
router.get('/plans', authMiddleware(['super_admin']), async (req, res) => {
  const [rows] = await db.query('SELECT * FROM plan_settings ORDER BY id');
  res.json({ success: true, data: rows });
});

// ─── UPDATE PLAN SETTINGS ─────────────────────────────────────────────────────
router.put('/plans/:plan_key', authMiddleware(['super_admin']), async (req, res) => {
  const { plan_key } = req.params;
  const { price_monthly_usd, price_yearly_usd, price_monthly_inr, price_yearly_inr, max_agents, max_chats_per_month, chat_history_days, max_websites, has_ai, has_custom_branding, has_analytics, has_canned_replies, has_white_label, has_api_access, has_ads_integration, plan_name } = req.body;
  try {
    await db.query(
      `UPDATE plan_settings SET plan_name=?, price_monthly_usd=?, price_yearly_usd=?, price_monthly_inr=?, price_yearly_inr=?,
       max_agents=?, max_chats_per_month=?, chat_history_days=?, max_websites=?, has_ai=?, has_custom_branding=?,
       has_analytics=?, has_canned_replies=?, has_white_label=?, has_api_access=?, has_ads_integration=? WHERE plan_key=?`,
      [plan_name, price_monthly_usd, price_yearly_usd, price_monthly_inr, price_yearly_inr,
       max_agents, max_chats_per_month || null, chat_history_days || null, max_websites || 5, has_ai, has_custom_branding,
       has_analytics, has_canned_replies, has_white_label, has_api_access, has_ads_integration ? 1 : 0, plan_key]
    );
    res.json({ success: true, message: 'Plan updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

// ─── GET AGENTS WITH FORGOT PASSWORD REQUESTS ─────────────────────────────────
router.get('/forgot-password-requests', authMiddleware(['super_admin']), async (req, res) => {
  const [rows] = await db.query(
    `SELECT a.id, a.name, a.email, a.forgot_password_at, b.company_name
     FROM agents a JOIN businesses b ON a.business_id = b.id
     WHERE a.forgot_password_requested = 1 ORDER BY a.forgot_password_at DESC`
  );
  res.json({ success: true, data: rows });
});

// ─── RESET AGENT PASSWORD (super admin) ──────────────────────────────────────
router.put('/reset-agent-password/:agent_id', authMiddleware(['super_admin']), async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { new_password } = req.body;
  const hash = await bcrypt.hash(new_password, 12);
  await db.query('UPDATE agents SET password_hash = ?, forgot_password_requested = 0 WHERE id = ?', [hash, req.params.agent_id]);
  res.json({ success: true, message: 'Password reset' });
});

// ─── VIEW SINGLE INVOICE ─────────────────────────────────────────────────────
router.get('/invoice/:id', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const [[t]] = await db.query(
      `SELECT pt.*, b.company_name, b.email, b.address, b.gstin, b.state,
              COALESCE(ps.plan_name, pt.plan_key) as plan_name
       FROM payment_transactions pt
       JOIN businesses b ON pt.business_id = b.id
       LEFT JOIN plan_settings ps ON pt.plan_key = ps.plan_key
       WHERE pt.id = ?`,
      [req.params.id]
    );
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    const generateInvoice = require('../utils/generateInvoice');
    const html = generateInvoice(t);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── VISITOR REPORTS ─────────────────────────────────────────────────────────
router.get('/visitor-reports', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const [reports] = await db.query(
      `SELECT vr.*, v.name as visitor_name, v.email as visitor_email, 
              v.ip_address, v.country, v.city,
              b.company_name, a.name as agent_name,
              bv.id as ban_id
       FROM visitor_reports vr
       JOIN visitors v ON vr.visitor_id = v.id
       JOIN businesses b ON vr.business_id = b.id
       LEFT JOIN agents a ON vr.reported_by = a.id
       LEFT JOIN banned_visitors bv ON bv.visitor_id = vr.visitor_id AND bv.is_active = 1
       ORDER BY vr.created_at DESC`
    );
    res.json({ success: true, data: reports });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/ban-visitor', authMiddleware(['super_admin']), async (req, res) => {
  const { visitor_id, business_id, reason } = req.body;
  try {
    const [[visitor]] = await db.query('SELECT * FROM visitors WHERE id = ?', [visitor_id]);
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
    // Delete existing ban if any, then insert fresh
    await db.query('DELETE FROM banned_visitors WHERE visitor_id = ? AND business_id = ?', 
      [visitor_id, business_id || visitor.business_id]);
    await db.query(
      `INSERT INTO banned_visitors (business_id, visitor_id, ip_address, email, country, reason, banned_by)
       VALUES (?,?,?,?,?,?,?)`,
      [business_id || visitor.business_id, visitor_id, visitor.ip_address, visitor.email, visitor.country, reason || 'Reported by agent', req.user.id]
    );
    // Update report status
    await db.query("UPDATE visitor_reports SET status = 'banned' WHERE visitor_id = ?", [visitor_id]);
    res.json({ success: true, message: 'Visitor banned successfully' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/visitor-reports/:id/ignore', authMiddleware(['super_admin']), async (req, res) => {
  try {
    await db.query("UPDATE visitor_reports SET status = 'ignored' WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/unban-visitor/:id', authMiddleware(['super_admin']), async (req, res) => {
  try {
    await db.query('UPDATE banned_visitors SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Visitor unbanned' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── VISITOR REPORTS ─────────────────────────────────────────────────────────
router.get('/visitor-reports', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT vr.*, 
             v.name as visitor_name, v.email as visitor_email, v.ip_address, v.country, v.city, v.phone,
             b.company_name,
             a.name as agent_name
      FROM visitor_reports vr
      LEFT JOIN visitors v ON vr.visitor_id = v.id
      LEFT JOIN businesses b ON vr.business_id = b.id
      LEFT JOIN agents a ON vr.reported_by = a.id
      ORDER BY vr.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/visitor-reports/:id/ban', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const [[report]] = await db.query(
      'SELECT vr.*, v.ip_address, v.email, v.country FROM visitor_reports vr LEFT JOIN visitors v ON vr.visitor_id = v.id WHERE vr.id = ?',
      [req.params.id]
    );
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    // Ban visitor
    await db.query(
      'INSERT INTO banned_visitors (business_id, visitor_id, ip_address, email, country, reason, banned_by) VALUES (?,?,?,?,?,?,?)',
      [report.business_id, report.visitor_id, report.ip_address, report.email, report.country, report.reason, req.user.id]
    );

    // Update report status
    await db.query(
      'UPDATE visitor_reports SET status = "banned", reviewed_at = NOW(), reviewed_by = ? WHERE id = ?',
      [req.user.id, req.params.id]
    );

    res.json({ success: true, message: 'Visitor banned successfully' });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/visitor-reports/:id/ignore', authMiddleware(['super_admin']), async (req, res) => {
  try {
    await db.query(
      'UPDATE visitor_reports SET status = "ignored", reviewed_at = NOW(), reviewed_by = ? WHERE id = ?',
      [req.user.id, req.params.id]
    );
    res.json({ success: true });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/banned-visitors/:id', authMiddleware(['super_admin']), async (req, res) => {
  try {
    await db.query('DELETE FROM banned_visitors WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Visitor unbanned' });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;

// ─── EDIT BUSINESS ────────────────────────────────────────────────────────────
router.put('/businesses/:id/edit', authMiddleware(['super_admin']), async (req, res) => {
  const { company_name, owner_name, phone, plan_key, billing_cycle, currency, account_status, plan_expires_at } = req.body;
  try {
    await db.query(
      `UPDATE businesses SET company_name=?, owner_name=?, phone=?, plan_key=?, billing_cycle=?, currency=?, account_status=?, plan_expires_at=? WHERE id=?`,
      [company_name, owner_name, phone, plan_key, billing_cycle, currency, account_status, plan_expires_at || null, req.params.id]
    );
    res.json({ success: true, message: 'Business updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── DELETE BUSINESS ─────────────────────────────────────────────────────────
router.delete('/businesses/:id', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const id = req.params.id;
    const { permanent } = req.query;
    if (permanent === 'true') {
      // Hard delete - remove all data
      await db.query('DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE business_id = ?)', [id]);
      await db.query('DELETE FROM chats WHERE business_id = ?', [id]);
      await db.query('DELETE FROM agents WHERE business_id = ?', [id]);
      await db.query('DELETE FROM payment_transactions WHERE business_id = ?', [id]);
      await db.query('DELETE FROM business_branding WHERE business_id = ?', [id]);
      await db.query('DELETE FROM canned_replies WHERE business_id = ?', [id]);
      await db.query('DELETE FROM businesses WHERE id = ?', [id]);
      res.json({ success: true, message: 'Business permanently deleted' });
    } else {
      // Soft delete - just mark as deleted, they cannot login
      await db.query("UPDATE businesses SET account_status = 'deleted' WHERE id = ?", [id]);
      await db.query("UPDATE agents SET is_active = 0 WHERE business_id = ?", [id]);
      res.json({ success: true, message: 'Business deleted. They can no longer login.' });
    }
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── EXTEND PLAN ─────────────────────────────────────────────────────────────
router.put('/businesses/:id/extend', authMiddleware(['super_admin']), async (req, res) => {
  const { days } = req.body;
  try {
    await db.query(
      `UPDATE businesses SET plan_expires_at = DATE_ADD(IFNULL(plan_expires_at, NOW()), INTERVAL ? DAY), account_status = 'active' WHERE id = ?`,
      [days, req.params.id]
    );
    res.json({ success: true, message: `Plan extended by ${days} days` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── RESET BUSINESS PASSWORD ──────────────────────────────────────────────────
router.put('/businesses/:id/reset-password', authMiddleware(['super_admin']), async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { new_password } = req.body;
  try {
    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE businesses SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── INVOICE REPORT ──────────────────────────────────────────────────────────
router.get('/invoice-report', async (req, res, next) => {
  // Allow token from query string for CSV downloads opened in new tab
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, authMiddleware(['super_admin']), async (req, res) => {
  const { status, format, month } = req.query;
  try {
    let q = `SELECT pt.id, pt.txn_id, pt.amount, pt.currency, pt.bank_account,
              pt.payment_status, pt.billing_cycle, pt.plan_key, pt.submitted_at, pt.reviewed_at,
              b.company_name, b.email, b.address, b.gstin, b.state,
              COALESCE(ps.plan_name, pt.plan_key) as plan_name,
              CONCAT('INV-', LPAD(pt.business_id,4,'0'), '-', LPAD(pt.id,6,'0')) as invoice_no
             FROM payment_transactions pt
             JOIN businesses b ON pt.business_id = b.id
             LEFT JOIN plan_settings ps ON pt.plan_key = ps.plan_key
             WHERE 1=1`;
    const params = [];

    if (status && status !== 'all') { q += ' AND pt.payment_status = ?'; params.push(status); }
    if (month) { q += ' AND DATE_FORMAT(pt.submitted_at, "%Y-%m") = ?'; params.push(month); }
    q += ' ORDER BY pt.submitted_at DESC';

    const [rows] = await db.query(q, params);

    // CSV export
    if (format === 'csv') {
      const headers = ['Invoice No','Company','Email','Plan','Amount','Currency','Billing','GST','Status','Date'];
      const csvRows = rows.map(r => {
        const isINR = r.currency === 'inr';
        const isTN = r.state?.toLowerCase() === 'tamil nadu';
        const gst = isINR ? (isTN ? `CGST 9% + SGST 9%` : `IGST 18%`) : 'N/A';
        return [
          r.invoice_no, r.company_name, r.email, r.plan_name,
          r.amount, r.currency?.toUpperCase(), r.billing_cycle,
          gst, r.payment_status,
          new Date(r.submitted_at).toLocaleDateString('en-IN')
        ].join(',');
      });
      const csv = [headers.join(','), ...csvRows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-report-${month || 'all'}.csv"`);
      return res.send(csv);
    }

    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── VISITOR REPORTS ──────────────────────────────────────────────────────────
router.get('/visitor-reports', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT vr.*, 
        v.name as visitor_name, v.email as visitor_email, v.ip_address, v.country, v.city,
        b.company_name,
        a.name as reported_by_name
       FROM visitor_reports vr
       LEFT JOIN visitors v ON vr.visitor_id = v.id
       LEFT JOIN businesses b ON vr.business_id = b.id
       LEFT JOIN agents a ON vr.reported_by = a.id
       ORDER BY vr.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/visitor-reports/:id/ban', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const [[report]] = await db.query(
      'SELECT vr.*, v.ip_address, v.email, v.country FROM visitor_reports vr LEFT JOIN visitors v ON vr.visitor_id = v.id WHERE vr.id = ?',
      [req.params.id]
    );
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    // Ban the visitor
    await db.query(
      `INSERT INTO banned_visitors (business_id, visitor_id, ip_address, email, country, reason, banned_by)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE reason=VALUES(reason), banned_by=VALUES(banned_by)`,
      [report.business_id, report.visitor_id, report.ip_address, report.email, report.country, report.reason, req.user.id]
    );

    // Update report status
    await db.query(
      'UPDATE visitor_reports SET status="banned", reviewed_by=?, reviewed_at=NOW() WHERE id=?',
      [req.user.id, req.params.id]
    );

    res.json({ success: true, message: 'Visitor banned successfully' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/visitor-reports/:id/ignore', authMiddleware(['super_admin']), async (req, res) => {
  try {
    await db.query(
      'UPDATE visitor_reports SET status="ignored", reviewed_by=?, reviewed_at=NOW() WHERE id=?',
      [req.user.id, req.params.id]
    );
    res.json({ success: true, message: 'Report ignored' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});