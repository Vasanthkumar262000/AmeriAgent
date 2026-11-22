const express = require('express');
const router = express.Router();
const chatCtrl = require('../controllers/chatController');
const authMiddleware = require('../middleware/auth');

// Public - widget (no auth)
router.get('/check-online', chatCtrl.checkAgentsOnline);
router.post('/init', chatCtrl.initChat);
router.post('/message', chatCtrl.sendMessage);
router.get('/:chat_id/messages', chatCtrl.getChatMessages);
router.post('/:chat_id/rate', chatCtrl.rateChat);

// Analytics must be before /:chat_id
router.get('/analytics', authMiddleware(['business']), chatCtrl.getAnalytics);

// Protected
router.get('/', authMiddleware(['business', 'agent', 'main_agent']), chatCtrl.getChats);
router.put('/:chat_id/resolve', authMiddleware(['agent', 'main_agent', 'business']), chatCtrl.resolveChat);
router.post('/:chat_id/notes', authMiddleware(['agent', 'main_agent']), chatCtrl.addNote);

module.exports = router;

// Save pre-chat answers (public - from widget)
router.post('/prechat-answers', async (req, res) => {
  const { chat_id, answers } = req.body;
  // answers = [{ question_id, question_text, answer }]
  try {
    if (!answers || !answers.length) return res.json({ success: true });
    for (const a of answers) {
      await require('../config/db').query(
        'INSERT INTO prechat_answers (chat_id, question_id, question_text, answer) VALUES (?, ?, ?, ?)',
        [chat_id, a.question_id, a.question_text, a.answer]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get pre-chat answers for a chat (agent view)
router.get('/:chat_id/prechat-answers', async (req, res) => {
  try {
    const db = require('../config/db');
    const [answers] = await db.query(
      'SELECT * FROM prechat_answers WHERE chat_id = ? ORDER BY id ASC',
      [req.params.chat_id]
    );
    res.json({ success: true, data: answers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Public branding endpoint — for widget to load on startup
router.get('/branding', async (req, res) => {
  const { bot_id } = req.query;
  if (!bot_id) return res.json({ success: false });
  try {
    const db = require('../config/db');
    const [rows] = await db.query(
      `SELECT bb.brand_color, bb.company_display_name, bb.logo_url, bb.show_powered_by,
              b.company_name, b.widget_position, b.greeting_enabled, b.greeting_delay_seconds,
              b.auto_greeting_message, b.welcome_message, b.offline_message
       FROM businesses b
       LEFT JOIN business_branding bb ON b.id = bb.business_id
       WHERE b.bot_id = ? AND b.account_status = 'active' LIMIT 1`,
      [bot_id]
    );
    if (!rows.length) return res.json({ success: false });
    const b = rows[0];
    res.json({
      success: true,
      data: {
        brand_color: b.brand_color || '#00d55b',
        company_name: b.company_display_name || b.company_name,
        logo_url: b.logo_url || '',
        show_powered_by: b.show_powered_by !== 0,
        widget_position: b.widget_position || 'bottom_right',
        greeting_enabled: b.greeting_enabled === 1,
        greeting_delay_seconds: b.greeting_delay_seconds || 5,
        auto_greeting_message: b.auto_greeting_message || '',
        welcome_message: b.welcome_message || '',
        offline_message: b.offline_message || ''
      }
    });
  } catch (err) {
    res.json({ success: false });
  }
});

// ─── REPORT VISITOR ───────────────────────────────────────────────────────────
router.post('/:chat_id/report-visitor', authMiddleware(['agent', 'main_agent', 'business']), async (req, res) => {
  const db = require('../config/db');
  const { reason } = req.body;
  const chat_id = req.params.chat_id;
  try {
    const [[chat]] = await db.query('SELECT * FROM chats WHERE id = ?', [chat_id]);
    if (!chat) return res.status(404).json({ success: false, message: 'Chat not found' });

    // Check if already reported
    const [[existing]] = await db.query(
      'SELECT id FROM visitor_reports WHERE chat_id = ? AND status = "pending"', [chat_id]
    );
    if (existing) return res.json({ success: false, message: 'Already reported' });

    await db.query(
      'INSERT INTO visitor_reports (business_id, visitor_id, chat_id, reported_by, reason) VALUES (?,?,?,?,?)',
      [chat.business_id, chat.visitor_id, chat_id, req.user.id, reason]
    );

    res.json({ success: true, message: 'Visitor reported to admin' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});