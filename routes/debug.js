const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

router.get('/fix-admin', async (req, res) => {
  try {
    const hash = await bcrypt.hash('MSAdmin2025', 10);
    await db.query('UPDATE super_admins SET password_hash = ? WHERE id = 1', [hash]);
    res.json({ success: true, message: 'Admin password updated to MSAdmin2025' });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

router.get('/fix-agent', async (req, res) => {
  try {
    const hash = await bcrypt.hash('MSAgent2025', 10);
    await db.query('UPDATE agents SET password_hash = ? WHERE id = 1', [hash]);
    res.json({ success: true, message: 'Agent password updated to MSAgent2025' });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

router.get('/fix-business', async (req, res) => {
  try {
    const hash = await bcrypt.hash('MSBusiness2025', 10);
    await db.query('UPDATE businesses SET password_hash = ? WHERE id = 1', [hash]);
    res.json({ success: true, message: 'Business password updated to MSBusiness2025' });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

router.get('/check-questions', async (req, res) => {
  try {
    const [businesses] = await db.query('SELECT id, company_name, bot_id, account_status FROM businesses');
    const [questions] = await db.query('SELECT id, business_id, question_text, question_type, is_active FROM prechat_questions');
    res.json({ businesses, questions, total_questions: questions.length });
  } catch(e) { res.json({ error: e.message }); }
});

router.get('/raw-questions/:bot_id', async (req, res) => {
  try {
    const [biz] = await db.query('SELECT id, bot_id FROM businesses WHERE bot_id = ?', [req.params.bot_id]);
    if (!biz.length) return res.json({ error: 'Business not found', bot_id: req.params.bot_id });
    const [questions] = await db.query('SELECT * FROM prechat_questions WHERE business_id = ?', [biz[0].id]);
    res.json({ business_id: biz[0].id, bot_id: biz[0].bot_id, questions, count: questions.length });
  } catch(e) { res.json({ error: e.message }); }
});

// Check prechat answers for a chat
router.get('/check-answers/:chat_id', async (req, res) => {
  try {
    const [answers] = await db.query('SELECT * FROM prechat_answers WHERE chat_id = ?', [req.params.chat_id]);
    const [chat] = await db.query('SELECT id, visitor_name, chat_type, status FROM chats WHERE id = ?', [req.params.chat_id]);
    res.json({ chat: chat[0] || null, answers, count: answers.length });
  } catch(e) { res.json({ error: e.message }); }
});

// Check business address and gstin
router.get('/check-business/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, company_name, email, address, gstin FROM businesses WHERE id = ?',
      [req.params.id]
    );
    res.json(rows[0] || { error: 'Not found' });
  } catch(e) { res.json({ error: e.message }); }
});

module.exports = router;