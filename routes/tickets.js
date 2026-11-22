const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');

// Get all tickets for a business
router.get('/', authMiddleware(['business']), async (req, res) => {
  try {
    const [tickets] = await db.query(
      `SELECT t.*, COUNT(tr.id) as reply_count
       FROM tickets t
       LEFT JOIN ticket_replies tr ON t.id = tr.ticket_id
       WHERE t.business_id = ?
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get single ticket with replies
router.get('/:id', authMiddleware(['business']), async (req, res) => {
  try {
    const [[ticket]] = await db.query('SELECT * FROM tickets WHERE id = ? AND business_id = ?', [req.params.id, req.user.id]);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const [replies] = await db.query('SELECT * FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC', [req.params.id]);
    res.json({ success: true, data: { ...ticket, replies } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Create ticket
router.post('/', authMiddleware(['business']), async (req, res) => {
  const { subject, category, message } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO tickets (business_id, subject, category, status) VALUES (?,?,?,?)',
      [req.user.id, subject, category || 'General', 'open']
    );
    await db.query(
      'INSERT INTO ticket_replies (ticket_id, sender_type, sender_id, message) VALUES (?,?,?,?)',
      [result.insertId, 'business', req.user.id, message]
    );
    res.json({ success: true, message: 'Ticket created', data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Reply to ticket (business)
router.post('/:id/reply', authMiddleware(['business']), async (req, res) => {
  const { message } = req.body;
  try {
    await db.query(
      'INSERT INTO ticket_replies (ticket_id, sender_type, sender_id, message) VALUES (?,?,?,?)',
      [req.params.id, 'business', req.user.id, message]
    );
    await db.query("UPDATE tickets SET status='in_progress', updated_at=NOW() WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// Get all tickets (admin)
router.get('/admin/all', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const [tickets] = await db.query(
      `SELECT t.*, b.company_name, b.email as business_email, COUNT(tr.id) as reply_count
       FROM tickets t
       JOIN businesses b ON t.business_id = b.id
       LEFT JOIN ticket_replies tr ON t.id = tr.ticket_id
       GROUP BY t.id
       ORDER BY t.created_at DESC`
    );
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get single ticket (admin)
router.get('/admin/:id', authMiddleware(['super_admin']), async (req, res) => {
  try {
    const [[ticket]] = await db.query(
      `SELECT t.*, b.company_name FROM tickets t JOIN businesses b ON t.business_id = b.id WHERE t.id = ?`,
      [req.params.id]
    );
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const [replies] = await db.query('SELECT * FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC', [req.params.id]);
    res.json({ success: true, data: { ...ticket, replies } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin reply
router.post('/admin/:id/reply', authMiddleware(['super_admin']), async (req, res) => {
  const { message, status } = req.body;
  try {
    await db.query(
      'INSERT INTO ticket_replies (ticket_id, sender_type, sender_id, message) VALUES (?,?,?,?)',
      [req.params.id, 'admin', req.user.id, message]
    );
    if (status) {
      await db.query('UPDATE tickets SET status=?, updated_at=NOW() WHERE id=?', [status, req.params.id]);
    } else {
      await db.query("UPDATE tickets SET status='in_progress', updated_at=NOW() WHERE id=?", [req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
