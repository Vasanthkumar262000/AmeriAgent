// business.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/auth');

// Get business profile
router.get('/profile', authMiddleware(['business']), async (req, res) => {
  const [rows] = await db.query(
    `SELECT b.*, bb.logo_url, bb.brand_color, bb.company_display_name, bb.show_powered_by,
            ps.plan_name, ps.max_agents, ps.max_chats_per_month, ps.has_ai,
            ps.has_custom_branding, ps.has_analytics, ps.has_canned_replies, ps.has_white_label,
            ps.has_ads_integration
     FROM businesses b
     LEFT JOIN business_branding bb ON b.id = bb.business_id
     JOIN plan_settings ps ON b.plan_key = ps.plan_key
     WHERE b.id = ?`,
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  delete rows[0].password_hash;
  res.json({ success: true, data: rows[0] });
});

// Update branding
router.put('/branding', authMiddleware(['business']), async (req, res) => {
  const { company_display_name, brand_color, show_powered_by, logo_url } = req.body;
  await db.query(
    `INSERT INTO business_branding (business_id, company_display_name, brand_color, show_powered_by, logo_url)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE company_display_name=?, brand_color=?, show_powered_by=?, logo_url=?`,
    [req.user.id, company_display_name, brand_color, show_powered_by, logo_url,
     company_display_name, brand_color, show_powered_by, logo_url]
  );
  res.json({ success: true, message: 'Branding updated' });
});

// Update widget settings
router.put('/widget', authMiddleware(['business']), async (req, res) => {
  const { welcome_message, offline_message, widget_position, greeting_enabled, greeting_delay_seconds, auto_greeting_message, operating_hours_enabled, operating_hours } = req.body;
  await db.query(
    `UPDATE businesses SET welcome_message=?, offline_message=?, widget_position=?,
     greeting_enabled=?, greeting_delay_seconds=?, auto_greeting_message=?,
     operating_hours_enabled=?, operating_hours=? WHERE id=?`,
    [welcome_message, offline_message, widget_position, greeting_enabled,
     greeting_delay_seconds, auto_greeting_message, operating_hours_enabled,
     JSON.stringify(operating_hours), req.user.id]
  );
  res.json({ success: true, message: 'Widget settings updated' });
});

// Get script tag
router.get('/script', authMiddleware(['business']), async (req, res) => {
  const [rows] = await db.query('SELECT bot_id, company_name FROM businesses WHERE id = ?', [req.user.id]);
  if (!rows.length) return res.status(404).json({ success: false });
  const script = `<script src="https://mschat.msdiscoveries.com/widget.js" data-bot-id="${rows[0].bot_id}"></script>`;
  res.json({ success: true, data: { script, bot_id: rows[0].bot_id } });
});

// Get canned replies
router.get('/canned-replies', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  const business_id = req.user.business_id || req.user.id;
  const [rows] = await db.query('SELECT * FROM canned_replies WHERE business_id = ? ORDER BY title', [business_id]);
  res.json({ success: true, data: rows });
});

// Add canned reply
router.post('/canned-replies', authMiddleware(['business']), async (req, res) => {
  const { title, message, shortcut } = req.body;
  await db.query('INSERT INTO canned_replies (business_id, title, message, shortcut) VALUES (?, ?, ?, ?)',
    [req.user.id, title, message, shortcut]);
  res.json({ success: true, message: 'Canned reply added' });
});

// Delete canned reply
router.delete('/canned-replies/:id', authMiddleware(['business']), async (req, res) => {
  await db.query('DELETE FROM canned_replies WHERE id = ? AND business_id = ?', [req.params.id, req.user.id]);
  res.json({ success: true, message: 'Deleted' });
});

// ─── AI SETTINGS ─────────────────────────────────────────────────────────────
router.put('/ai-settings', authMiddleware(['business']), async (req, res) => {
  const { ai_enabled, ai_instructions } = req.body;
  try {
    await db.query(
      'UPDATE businesses SET ai_enabled=?, ai_instructions=? WHERE id=?',
      [ai_enabled ? 1 : 0, ai_instructions || '', req.user.id]
    );
    res.json({ success: true, message: 'AI settings saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── CRM ─────────────────────────────────────────────────────────────────────
router.get('/crm', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  const business_id = req.user.business_id || req.user.id;
  try {
    const [rows] = await db.query(
      `SELECT v.*, COUNT(c.id) as chat_count
       FROM visitors v
       LEFT JOIN chats c ON v.id = c.visitor_id
       WHERE v.business_id = ?
       GROUP BY v.id
       ORDER BY v.first_visit_at DESC`,
      [business_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/crm/:id', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  const business_id = req.user.business_id || req.user.id;
  try {
    const [[visitor]] = await db.query(
      'SELECT v.*, COUNT(c.id) as chat_count FROM visitors v LEFT JOIN chats c ON v.id = c.visitor_id WHERE v.id = ? AND v.business_id = ? GROUP BY v.id',
      [req.params.id, business_id]
    );
    if (!visitor) return res.status(404).json({ success: false, message: 'Contact not found' });
    const [notes] = await db.query(
      'SELECT * FROM crm_notes WHERE visitor_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ success: true, data: { ...visitor, notes: notes || [] } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/crm/:id', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  const business_id = req.user.business_id || req.user.id;
  try {
    const allowed = ['crm_status', 'crm_tag', 'follow_up_date'];
    const updates = [];
    const values = [];
    allowed.forEach(field => {
      if (req.body.hasOwnProperty(field)) {
        updates.push(field + '=?');
        values.push(req.body[field] || null);
      }
    });
    if (updates.length === 0) return res.json({ success: true });
    values.push(req.params.id, business_id);
    await db.query(
      'UPDATE visitors SET ' + updates.join(', ') + ' WHERE id=? AND business_id=?',
      values
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/crm/:id/notes', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  const { note } = req.body;
  const business_id = req.user.business_id || req.user.id;
  try {
    await db.query('INSERT INTO crm_notes (visitor_id, business_id, note, created_by) VALUES (?,?,?,?)',
      [req.params.id, business_id, note, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── LEADS ───────────────────────────────────────────────────────────────────
router.get('/leads', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  const business_id = req.user.business_id || req.user.id;
  try {
    const [leads] = await db.query(
      `SELECT v.*, COUNT(c.id) as chat_count
       FROM visitors v
       LEFT JOIN chats c ON v.id = c.visitor_id
       WHERE v.business_id = ?
       GROUP BY v.id
       ORDER BY v.first_visit_at DESC`,
      [business_id]
    );
    res.json({ success: true, data: leads });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── LEAD MESSAGES (form submissions linked to a visitor) ────────────────────
router.get('/leads/:id/messages', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  const business_id = req.user.business_id || req.user.id;
  const visitor_id  = req.params.id;
  try {
    const [[visitor]] = await db.query('SELECT email FROM visitors WHERE id = ? AND business_id = ?', [visitor_id, business_id]);
    if (!visitor) return res.json({ success: true, data: [] });

    const [msgs] = await db.query(
      `SELECT * FROM offline_messages
       WHERE business_id = ?
         AND (visitor_id = ? OR email = ?)
       ORDER BY created_at DESC`,
      [business_id, visitor_id, visitor.email]
    );
    res.json({ success: true, data: msgs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── API USAGE STATS ─────────────────────────────────────────────────────────
router.get('/api-usage', authMiddleware(['business']), async (req, res) => {
  const business_id = req.user.id;
  try {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';
    const [[todayUsage]] = await db.query(
      'SELECT calls_today FROM api_usage WHERE business_id = ? AND date = ?',
      [business_id, today]
    );
    const [[monthUsage]] = await db.query(
      'SELECT SUM(calls_today) as total FROM api_usage WHERE business_id = ? AND date >= ?',
      [business_id, monthStart]
    );
    res.json({ success: true, data: { today: todayUsage?.calls_today || 0, month: monthUsage?.total || 0 } });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── API KEY MANAGEMENT ──────────────────────────────────────────────────────
router.get('/api-key', authMiddleware(['business']), async (req, res) => {
  try {
    const [[key]] = await db.query('SELECT * FROM business_api_keys WHERE business_id = ?', [req.user.id]);
    res.json({ success: true, data: key || null });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/api-key/generate', authMiddleware(['business']), async (req, res) => {
  try {
    const crypto = require('crypto');
    const apiKey = 'msc_' + req.user.id + '_' + crypto.randomBytes(24).toString('hex');
    await db.query(
      `INSERT INTO business_api_keys (business_id, api_key) VALUES (?,?)
       ON DUPLICATE KEY UPDATE api_key=?, created_at=NOW()`,
      [req.user.id, apiKey, apiKey]
    );
    res.json({ success: true, data: { api_key: apiKey, created_at: new Date() } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── AI BOT SETTINGS ─────────────────────────────────────────────────────────
router.get('/ai-bot/settings', authMiddleware(['business']), async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT * FROM ai_bot_settings WHERE business_id = ?', [req.user.id]);
    res.json({ success: true, data: row || null });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/ai-bot/settings', authMiddleware(['business']), async (req, res) => {
  const { bot_enabled, start_time, end_time, welcome_message, fallback_message, outside_hours_message } = req.body;
  try {
    await db.query(
      `INSERT INTO ai_bot_settings (business_id, bot_enabled, start_time, end_time, welcome_message, fallback_message, outside_hours_message)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE bot_enabled=?, start_time=?, end_time=?, welcome_message=?, fallback_message=?, outside_hours_message=?`,
      [req.user.id, bot_enabled, start_time, end_time, welcome_message, fallback_message, outside_hours_message,
       bot_enabled, start_time, end_time, welcome_message, fallback_message, outside_hours_message]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/ai-bot/keywords', authMiddleware(['business']), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ai_bot_keywords WHERE business_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/ai-bot/keywords', authMiddleware(['business']), async (req, res) => {
  const { keyword, match_type, reply } = req.body;
  try {
    await db.query('INSERT INTO ai_bot_keywords (business_id, keyword, match_type, reply) VALUES (?,?,?,?)',
      [req.user.id, keyword.toLowerCase().trim(), match_type || 'contains', reply]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/ai-bot/keywords/:id', authMiddleware(['business']), async (req, res) => {
  const { keyword, match_type, reply, is_active } = req.body;
  try {
    await db.query('UPDATE ai_bot_keywords SET keyword=?, match_type=?, reply=?, is_active=? WHERE id=? AND business_id=?',
      [keyword, match_type, reply, is_active, req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/ai-bot/keywords/:id', authMiddleware(['business']), async (req, res) => {
  try {
    await db.query('DELETE FROM ai_bot_keywords WHERE id=? AND business_id=?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── REPORT VISITOR ──────────────────────────────────────────────────────────
router.post('/report-visitor', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  const { visitor_id, chat_id, reason } = req.body;
  const business_id = req.user.business_id || req.user.id;
  const agent_id = req.user.role === 'business' ? null : req.user.id;
  try {
    const [[visitor]] = await db.query('SELECT * FROM visitors WHERE id = ?', [visitor_id]);
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });
    await db.query(
      'INSERT INTO visitor_reports (business_id, visitor_id, chat_id, reported_by, reason, ip_address, email) VALUES (?,?,?,?,?,?,?)',
      [business_id, visitor_id, chat_id || null, agent_id, reason, visitor.ip_address, visitor.email]
    );
    res.json({ success: true, message: 'Visitor reported to admin' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── VISITOR REPORT ──────────────────────────────────────────────────────────
router.post('/visitors/:id/report', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  const { chat_id, reason } = req.body;
  const business_id = req.user.business_id || req.user.id;
  const reported_by = req.user.id;
  try {
    const [[visitor]] = await db.query('SELECT * FROM visitors WHERE id = ?', [req.params.id]);
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });

    await db.query(
      'INSERT INTO visitor_reports (business_id, visitor_id, chat_id, reported_by, reason) VALUES (?,?,?,?,?)',
      [business_id, req.params.id, chat_id, reported_by, reason]
    );

    try {
      const { sendEmail } = require('../utils/email');
      const [[agent]] = await db.query('SELECT name FROM agents WHERE id = ?', [reported_by]);
      const [[biz]] = await db.query('SELECT company_name FROM businesses WHERE id = ?', [business_id]);
      await sendEmail(
        process.env.SUPER_ADMIN_EMAIL,
        `🚩 Visitor Reported - ${biz?.company_name}`,
        `<div style="font-family:sans-serif;padding:20px">
          <h2 style="color:#ff4444">Visitor Reported</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;color:#666">Company</td><td style="padding:8px;font-weight:bold">${biz?.company_name}</td></tr>
            <tr><td style="padding:8px;color:#666">Reported By</td><td style="padding:8px">${agent?.name || 'Agent'}</td></tr>
            <tr><td style="padding:8px;color:#666">Visitor Name</td><td style="padding:8px">${visitor.name || 'Unknown'}</td></tr>
            <tr><td style="padding:8px;color:#666">Visitor Email</td><td style="padding:8px">${visitor.email || 'N/A'}</td></tr>
            <tr><td style="padding:8px;color:#666">Visitor IP</td><td style="padding:8px">${visitor.ip_address || 'N/A'}</td></tr>
            <tr><td style="padding:8px;color:#666">Country</td><td style="padding:8px">${visitor.country || 'N/A'}</td></tr>
            <tr><td style="padding:8px;color:#666">Reason</td><td style="padding:8px;color:#ff4444;font-weight:bold">${reason}</td></tr>
          </table>
          <p style="margin-top:16px">Login to admin panel to ban: <a href="https://mschat.msdiscoveries.com/super">MSChat Admin</a></p>
        </div>`
      );
    } catch(e) { console.log('Report email failed:', e.message); }

    res.json({ success: true, message: 'Visitor reported to admin successfully' });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─── GET Ads Integration Settings ────────────────────────────────────────────
router.get('/ads-integration', authMiddleware(['business']), async (req, res) => {
  try {
    const [[row]] = await db.query(
      `SELECT b.meta_page_id, b.google_ads_secret, b.property_portal_secret,
              ps.has_ads_integration
       FROM businesses b
       JOIN plan_settings ps ON b.plan_key = ps.plan_key
       WHERE b.id = ?`,
      [req.user.id]
    );
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    if (!row.has_ads_integration) return res.status(403).json({ success: false, message: 'Ad Platform Integration is not available on your plan. Upgrade to Pack Two or Pack Advanced.' });
    res.json({ success: true, data: { meta_page_id: row.meta_page_id || '', google_ads_secret: row.google_ads_secret || '', property_portal_secret: row.property_portal_secret || '' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── SAVE Ads Integration Settings ───────────────────────────────────────────
router.put('/ads-integration', authMiddleware(['business']), async (req, res) => {
  const { meta_page_id, google_ads_secret, property_portal_secret } = req.body;
  try {
    const [[plan]] = await db.query(
      'SELECT ps.has_ads_integration FROM plan_settings ps JOIN businesses b ON b.plan_key = ps.plan_key WHERE b.id = ?',
      [req.user.id]
    );
    if (!plan?.has_ads_integration) return res.status(403).json({ success: false, message: 'Ad Platform Integration is not available on your plan. Upgrade to Pack Two or Pack Advanced.' });

    await db.query(
      'UPDATE businesses SET meta_page_id = ?, google_ads_secret = ?, property_portal_secret = ? WHERE id = ?',
      [meta_page_id || null, google_ads_secret || null, property_portal_secret || null, req.user.id]
    );
    res.json({ success: true, message: 'Integration settings saved!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET Contact Form Settings ────────────────────────────────────────────────
router.get('/contact-form-settings', authMiddleware(['business']), async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT * FROM contact_form_settings WHERE business_id = ?',
      [req.user.id]
    );
    if (!row) return res.json({ success: true, data: null });
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── SAVE Contact Form Settings ───────────────────────────────────────────────
router.put('/contact-form-settings', authMiddleware(['business']), async (req, res) => {
  const {
    title, subtitle, btn_text, color, width, font_size, rounded, theme,
    show_phone, show_message, popup_delay,
    industry,
    custom_fields,
  } = req.body;
  try {
    await db.query(
      `INSERT INTO contact_form_settings
         (business_id, title, subtitle, btn_text, color, width, font_size, rounded,
          theme, show_phone, show_message, popup_delay, industry, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), subtitle=VALUES(subtitle), btn_text=VALUES(btn_text),
         color=VALUES(color), width=VALUES(width), font_size=VALUES(font_size),
         rounded=VALUES(rounded), theme=VALUES(theme), show_phone=VALUES(show_phone),
         show_message=VALUES(show_message), popup_delay=VALUES(popup_delay),
         industry=VALUES(industry), custom_fields=VALUES(custom_fields)`,
      [
        req.user.id, title, subtitle, btn_text, color, width, font_size, rounded,
        theme, show_phone ? 1 : 0, show_message ? 1 : 0, popup_delay || 10,
        industry || 'general', custom_fields || null,
      ]
    );
    res.json({ success: true, message: 'Contact form settings saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PRE-CHAT QUESTIONS ───────────────────────────────────────────────────────

// Get questions (for widget - public)
router.get('/prechat-questions/:bot_id', async (req, res) => {
  try {
    const [biz] = await db.query('SELECT id FROM businesses WHERE bot_id = ?', [req.params.bot_id]);
    if (!biz.length) return res.json({ success: true, data: [] });
    const [questions] = await db.query(
      'SELECT id, question_order, question_text, question_type, options, is_required, is_active FROM prechat_questions WHERE business_id = ? AND is_active = 1 ORDER BY question_order ASC',
      [biz[0].id]
    );
    questions.forEach(q => {
      if (q.options) try { q.options = JSON.parse(q.options); } catch(e) { q.options = []; }
      q.is_active = q.is_active === 1 || q.is_active === true ? 1 : 0;
      q.is_required = q.is_required === 1 || q.is_required === true ? 1 : 0;
    });
    res.json({ success: true, data: questions });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// Get questions (for business dashboard)
router.get('/prechat-questions', authMiddleware(['business']), async (req, res) => {
  try {
    const [questions] = await db.query(
      'SELECT * FROM prechat_questions WHERE business_id = ? ORDER BY question_order ASC',
      [req.user.id]
    );
    questions.forEach(q => { if (q.options) try { q.options = JSON.parse(q.options); } catch(e) { q.options = []; } });
    res.json({ success: true, data: questions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get questions' });
  }
});

// Add question
router.post('/prechat-questions', authMiddleware(['business']), async (req, res) => {
  const { question_text, question_type, options, is_required } = req.body;
  try {
    if (!question_text || !question_text.trim()) {
      return res.status(400).json({ success: false, message: 'Question text is required' });
    }

    const [[biz]] = await db.query('SELECT plan_key FROM businesses WHERE id = ?', [req.user.id]);
    const planKey = biz?.plan_key || 'pack_one';
    const limits = { pack_one: 4, pack_two: 12, pack_three: 20, pack_advanced: 9999 };
    const limit = limits[planKey] || 4;

    const [[countRow]] = await db.query('SELECT COUNT(*) as c FROM prechat_questions WHERE business_id = ? AND is_active = 1', [req.user.id]);
    if (countRow.c >= limit) {
      return res.status(400).json({ success: false, message: `Your plan allows maximum ${limit} questions. Upgrade to add more.` });
    }

    const [[orderRow]] = await db.query('SELECT COALESCE(MAX(question_order), 0) + 1 as next FROM prechat_questions WHERE business_id = ?', [req.user.id]);

    await db.query(
      'INSERT INTO prechat_questions (business_id, question_order, question_text, question_type, options, is_required) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, orderRow.next, question_text.trim(), question_type || 'text', options && options.length ? JSON.stringify(options) : null, is_required ? 1 : 0]
    );
    res.json({ success: true, message: 'Question added successfully' });
  } catch (err) {
    console.error('Add question error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update question
router.put('/prechat-questions/:id', authMiddleware(['business']), async (req, res) => {
  const { question_text, question_type, options, is_required, is_active, question_order } = req.body;
  try {
    if (!question_text || !question_text.trim()) {
      return res.status(400).json({ success: false, message: 'Question text is required' });
    }
    let optionsJson = null;
    if (options && options.length > 0) {
      optionsJson = Array.isArray(options) ? JSON.stringify(options) : options;
    }
    await db.query(
      'UPDATE prechat_questions SET question_text=?, question_type=?, options=?, is_required=?, is_active=?, question_order=? WHERE id=? AND business_id=?',
      [question_text.trim(), question_type || 'text', optionsJson, is_required ? 1 : 0, is_active !== undefined ? (is_active ? 1 : 0) : 1, question_order || 1, req.params.id, req.user.id]
    );
    res.json({ success: true, message: 'Question updated' });
  } catch (err) {
    console.error('Update question error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete question
router.delete('/prechat-questions/:id', authMiddleware(['business']), async (req, res) => {
  try {
    await db.query('DELETE FROM prechat_questions WHERE id = ? AND business_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true, message: 'Question deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
});

// Save answers (from widget - public)
router.post('/prechat-answers', async (req, res) => {
  const { chat_id, answers } = req.body;
  try {
    for (const ans of answers) {
      await db.query(
        'INSERT INTO prechat_answers (chat_id, question_id, question_text, answer) VALUES (?, ?, ?, ?)',
        [chat_id, ans.question_id, ans.question_text, ans.answer]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save answers' });
  }
});

// Get answers for a chat (agent view)
router.get('/prechat-answers/:chat_id', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  try {
    const [answers] = await db.query(
      'SELECT * FROM prechat_answers WHERE chat_id = ? ORDER BY id ASC',
      [req.params.chat_id]
    );
    res.json({ success: true, data: answers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get answers' });
  }
});

// ─── UPLOAD LOGO ──────────────────────────────────────────────────────────────
const multerLogo = require('multer');
const pathLogo = require('path');
const logoStorage = multerLogo.diskStorage({
  destination: (req, file, cb) => cb(null, require('path').join(__dirname, '../uploads')),
  filename: (req, file, cb) => cb(null, `logo_${req.user.id}_${Date.now()}${pathLogo.extname(file.originalname)}`)
});
const uploadLogo = multerLogo({ storage: logoStorage, limits: { fileSize: 2 * 1024 * 1024 } });

router.post('/upload-logo', authMiddleware(['business']), uploadLogo.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
  const url = `https://api.mschat.msdiscoveries.com/uploads/${req.file.filename}`;
  await db.query(
    `INSERT INTO business_branding (business_id, logo_url) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE logo_url = ?`,
    [req.user.id, url, url]
  );
  res.json({ success: true, url });
});

// ─── UPDATE BUSINESS DETAILS ──────────────────────────────────────────────────
router.put('/details', authMiddleware(['business']), async (req, res) => {
  const { company_name, owner_name, phone, address, gstin, state } = req.body;
  try {
    await db.query(
      'UPDATE businesses SET company_name=?, owner_name=?, phone=?, address=?, gstin=?, state=? WHERE id=?',
      [company_name, owner_name, phone, address || '', gstin || '', state || '', req.user.id]
    );
    res.json({ success: true, message: 'Business details updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── CRM EXPORT CSV ───────────────────────────────────────────────────────────
router.get('/crm/export-csv', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  try {
    const businessId = req.user.business_id || req.user.id;

    const [contacts] = await db.query(
      `SELECT v.id, v.name, v.phone, v.email, v.city, v.country,
              v.crm_status, v.crm_tag, v.follow_up_date, v.lead_source,
              GROUP_CONCAT(cn.note ORDER BY cn.created_at DESC SEPARATOR ' | ') AS notes
       FROM visitors v
       LEFT JOIN crm_notes cn ON cn.visitor_id = v.id AND cn.business_id = ?
       WHERE v.business_id = ?
       GROUP BY v.id
       ORDER BY v.first_visit_at DESC`,
      [businessId, businessId]
    );

    const headers = ['name','phone','email','crm_status','crm_tag','lead_source','follow_up_date','notes'];
    const escape = (val) => {
      const str = String(val ?? '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const csv = [
      headers.join(','),
      ...contacts.map(c => headers.map(h => escape(c[h])).join(','))
    ].join('\n');

    const filename = `crm_export_${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── CRM IMPORT CSV ────────────────────────────────────────────────────────────
router.post('/crm/import-csv', authMiddleware(['business', 'agent', 'main_agent']), async (req, res) => {
  try {
    const businessId = req.user.business_id || req.user.id;
    const { contacts } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ success: false, message: 'No contacts provided' });
    }

    let imported = 0;

    for (const c of contacts) {
      const name  = (c.name  || '').trim();
      const email = (c.email || '').trim().toLowerCase();
      const phone = (c.phone || '').trim();

      if (!name && !email && !phone) continue;

      // Allowed CRM status values
      const VALID_STATUSES = ['New', 'Contacted', 'Qualified', 'Closed'];
      const VALID_TAGS = ['Hot 🔥', 'Warm 🌡️', 'Cold ❄️'];
      const crm_status   = VALID_STATUSES.includes(c.crm_status) ? c.crm_status : 'New';
      const crm_tag      = VALID_TAGS.includes(c.crm_tag) ? c.crm_tag : null;
      const follow_up    = c.follow_up_date && !isNaN(Date.parse(c.follow_up_date)) ? c.follow_up_date : null;
      const lead_source  = c.lead_source || 'import';

      // Upsert visitor by email or phone
      let visitorId = null;
      if (email) {
        const [[existing]] = await db.query(
          'SELECT id FROM visitors WHERE business_id = ? AND email = ? LIMIT 1',
          [businessId, email]
        );
        visitorId = existing?.id || null;
      }
      if (!visitorId && phone) {
        const [[existing]] = await db.query(
          'SELECT id FROM visitors WHERE business_id = ? AND phone = ? LIMIT 1',
          [businessId, phone]
        );
        visitorId = existing?.id || null;
      }

      if (visitorId) {
        // Update existing visitor CRM fields
        await db.query(
          `UPDATE visitors SET
             name = COALESCE(NULLIF(?, ''), name),
             phone = COALESCE(NULLIF(?, ''), phone),
             crm_status = ?, crm_tag = ?,
             follow_up_date = COALESCE(?, follow_up_date),
             lead_source = COALESCE(NULLIF(?, ''), lead_source)
           WHERE id = ? AND business_id = ?`,
          [name, phone, crm_status, crm_tag, follow_up, lead_source, visitorId, businessId]
        );
      } else {
        // Insert new visitor
        const [result] = await db.query(
          `INSERT INTO visitors (business_id, name, email, phone, crm_status, crm_tag, follow_up_date, lead_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [businessId, name, email, phone, crm_status, crm_tag, follow_up, lead_source]
        );
        visitorId = result.insertId;
      }

      // Add note if provided
      if (c.notes && c.notes.trim() && visitorId) {
        await db.query(
          'INSERT INTO crm_notes (visitor_id, business_id, note, created_by) VALUES (?, ?, ?, ?)',
          [visitorId, businessId, c.notes.trim(), req.user.id]
        );
      }

      imported++;
    }

    res.json({ success: true, imported, message: `${imported} contacts imported successfully` });
  } catch (err) {
    console.error('CRM import error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── module.exports MUST be at the very end ───────────────────────────────────
module.exports = router;