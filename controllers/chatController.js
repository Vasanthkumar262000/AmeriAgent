const db = require('../config/db');
require('dotenv').config();

// ─── AI REPLY HELPER ──────────────────────────────────────────────────────────
async function triggerAIReply(chat_id, message_text, businessId) {
  try {
    const { getAIReply } = require('../utils/aiChatbot');
    const aiReply = await getAIReply(chat_id, message_text, businessId);
    if (!aiReply) return;
    await db.query('INSERT INTO messages (chat_id, sender_type, message_text) VALUES (?, "ai", ?)', [chat_id, aiReply]);
    if (global.io) {
      global.io.to(`chat:${chat_id}`).emit('message:received', {
        chat_id, message_text: aiReply, sender_type: 'ai',
        sender_name: 'AI Assistant', sent_at: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error('AI reply error:', err.message);
  }
}

// ─── CHECK AGENTS ONLINE ──────────────────────────────────────────────────────
exports.checkAgentsOnline = async (req, res) => {
  const { bot_id } = req.query;
  try {
    const [biz] = await db.query(
      `SELECT b.id, ps.has_ai FROM businesses b
       JOIN plan_settings ps ON b.plan_key = ps.plan_key
       WHERE b.bot_id = ? AND b.account_status = 'active'`,
      [bot_id]
    );
    if (!biz.length) return res.json({ success: false, agents_online: false, has_ai: false });
    const [agents] = await db.query(
      'SELECT id FROM agents WHERE business_id = ? AND online_status = "online" LIMIT 1',
      [biz[0].id]
    );
    res.json({ success: true, agents_online: agents.length > 0, has_ai: biz[0].has_ai === 1 });
  } catch (err) {
    console.error('checkOnline error:', err.message);
    res.json({ success: false, agents_online: false, has_ai: false });
  }
};

// ─── INIT CHAT ────────────────────────────────────────────────────────────────
exports.initChat = async (req, res) => {
  const { bot_id, visitor_name, visitor_email, visitor_phone, current_page, user_agent, referrer, reason } = req.body;
  try {
    // Get business
    const [bizRows] = await db.query(
      `SELECT b.id, b.company_name, b.welcome_message, b.offline_message,
              b.chats_used_this_month, b.account_status,
              ps.max_chats_per_month, ps.has_ai, ps.max_websites,
              bb.brand_color, bb.company_display_name, bb.logo_url, bb.show_powered_by
       FROM businesses b
       JOIN plan_settings ps ON b.plan_key = ps.plan_key
       LEFT JOIN business_branding bb ON b.id = bb.business_id
       WHERE b.bot_id = ? AND b.account_status = 'active'`,
      [bot_id]
    );
    if (!bizRows.length) return res.status(404).json({ success: false, message: 'Chat service not available' });
    const biz = bizRows[0];

    // Check monthly chat limit
    if (biz.max_chats_per_month && biz.chats_used_this_month >= biz.max_chats_per_month) {
      return res.status(429).json({ success: false, message: 'Monthly chat limit reached.' });
    }

    // Check website/domain limit
    const domain = current_page ? new URL(current_page).hostname.replace('www.', '') : '';
    if (domain) {
      const [[existingDomain]] = await db.query(
        'SELECT id FROM registered_websites WHERE business_id = ? AND domain = ?',
        [biz.id, domain]
      );
      if (!existingDomain) {
        const [[domainCount]] = await db.query(
          'SELECT COUNT(*) as c FROM registered_websites WHERE business_id = ?',
          [biz.id]
        );
        if (domainCount.c >= (biz.max_websites || 5)) {
          return res.status(403).json({ success: false, message: `Website limit reached (${biz.max_websites || 5} websites). Please upgrade your plan.` });
        }
        await db.query(
          'INSERT IGNORE INTO registered_websites (business_id, domain) VALUES (?,?)',
          [biz.id, domain]
        );
      }
    }

    // Device detection
    const isMobile = /mobile|android|iphone|ipad/i.test(user_agent || '');
    const device_type = isMobile ? 'mobile' : 'desktop';
    const browser = (user_agent || '').match(/(chrome|firefox|safari|edge|opera)/i)?.[1] || 'unknown';

    // Get visitor IP
    const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();

    // Get country from IP using geoip-lite
    let country = null, city = null;
    try {
      const geoip = require('geoip-lite');
      const geo = geoip.lookup(ip);
      if (geo) { country = geo.country; city = geo.city; }
    } catch(e) {}

    // Check if visitor is banned (by IP or email)
    const [banned] = await db.query(
      'SELECT id FROM banned_visitors WHERE business_id = ? AND (ip_address = ? OR email = ?)',
      [biz.id, ip, visitor_email || '']
    );
    if (banned.length) {
      return res.status(403).json({ success: false, message: 'Unable to connect to chat support.', banned: true });
    }

    // Create or update visitor record
    let visitor_id;
    const [existing] = await db.query(
      'SELECT id FROM visitors WHERE business_id = ? AND email = ? LIMIT 1',
      [biz.id, visitor_email || '']
    );
    if (existing.length) {
      visitor_id = existing[0].id;
      await db.query(
        'UPDATE visitors SET name=?, phone=?, last_visit_at=NOW(), ip_address=?, country=COALESCE(country,?), city=COALESCE(city,?) WHERE id=?',
        [visitor_name || '', visitor_phone || '', ip, country, city, visitor_id]
      );
    } else {
      const [vr] = await db.query(
        'INSERT INTO visitors (business_id, name, email, phone, device_type, browser, traffic_source, ip_address, country, city) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [biz.id, visitor_name || 'Visitor', visitor_email || '', visitor_phone || '', device_type, browser, referrer || 'direct', ip, country, city]
      );
      visitor_id = vr.insertId;
    }

    // Get all online agents for Round Robin
    const [onlineAgents] = await db.query(
      'SELECT id FROM agents WHERE business_id = ? AND online_status = "online" ORDER BY id ASC',
      [biz.id]
    );

    const agentsOnline = onlineAgents.length > 0;
    const hasAI = biz.has_ai === 1;
    const chat_type = agentsOnline ? 'live' : (hasAI ? 'ai' : 'offline');
    // open = waiting for agent response, missed = no agents online
    const chat_status = (!agentsOnline && !hasAI) ? 'missed' : 'open';

    // Smart assignment:
    // - If only 1 agent online → all chats go to that agent
    // - If multiple agents → Round Robin rotation
    let assignedAgentId = null;
    if (agentsOnline && onlineAgents.length > 0) {
      if (onlineAgents.length === 1) {
        // Only one agent online - all chats go to them
        assignedAgentId = onlineAgents[0].id;
      } else {
        // Round Robin among all online agents
        const [[lastChat]] = await db.query(
          `SELECT agent_id FROM chats 
           WHERE business_id = ? AND agent_id IS NOT NULL 
           AND agent_id IN (${onlineAgents.map(() => '?').join(',')})
           ORDER BY id DESC LIMIT 1`,
          [biz.id, ...onlineAgents.map(a => a.id)]
        );
        const lastAgentId = lastChat?.agent_id;
        if (!lastAgentId) {
          assignedAgentId = onlineAgents[0].id;
        } else {
          const lastIdx = onlineAgents.findIndex(a => a.id === lastAgentId);
          const nextIdx = (lastIdx + 1) % onlineAgents.length;
          assignedAgentId = onlineAgents[nextIdx].id;
        }
      }
    }

    // Create chat with Round Robin assigned agent
    const [chatResult] = await db.query(
      `INSERT INTO chats (business_id, visitor_id, agent_id, chat_type, status, current_page)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [biz.id, visitor_id, assignedAgentId, chat_type, chat_status, current_page || '/']
    );
    const chatId = chatResult.insertId;

    // Increment chat count
    await db.query('UPDATE businesses SET chats_used_this_month = chats_used_this_month + 1 WHERE id = ?', [biz.id]);

    // Notify business dashboard — new chat
    db.query(
      `INSERT INTO business_notifications (business_id, type, title, message) VALUES (?, 'new_chat', 'New Chat Started 💬', ?)`,
      [biz.id, `${visitor_name || 'A visitor'} started a new chat from ${current_page || 'your website'}.`]
    ).catch(() => {});

    // Save welcome message
    const welcomeMsg = biz.welcome_message || `Hi ${visitor_name}! How can we help you today?`;
    await db.query('INSERT INTO messages (chat_id, sender_type, message_text) VALUES (?, "system", ?)', [chatId, welcomeMsg]);

    // If offline — save offline record and send offline message
    if (!agentsOnline && !hasAI) {
      const offlineMsg = biz.offline_message || 'We are currently offline. We will get back to you soon.';
      await db.query('INSERT INTO messages (chat_id, sender_type, message_text) VALUES (?, "system", ?)', [chatId, offlineMsg]);

      // Save to offline_messages
      try {
        await db.query(
          'INSERT INTO offline_messages (business_id, name, email, phone, message) VALUES (?,?,?,?,?)',
          [biz.id, visitor_name || '', visitor_email || '', visitor_phone || '', reason || 'General enquiry']
        );
      } catch(e) { console.log('offline_messages insert:', e.message); }
    }

    res.json({
      success: true,
      data: {
        chat_id: chatId,
        chat_type,
        agents_online: agentsOnline,
        has_ai: hasAI,
        welcome_message: welcomeMsg,
        offline_message: biz.offline_message,
        branding: {
          company_name: biz.company_display_name || biz.company_name,
          brand_color: biz.brand_color || '#00d55b',
          logo_url: biz.logo_url || '',
          show_powered_by: biz.show_powered_by !== 0
        }
      }
    });
  } catch (err) {
    console.error('initChat ERROR:', err.message);
    res.status(500).json({ success: false, message: 'Failed to initialize chat: ' + err.message });
  }
};

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
exports.sendMessage = async (req, res) => {
  const { chat_id, message_text, sender_type, sender_id } = req.body;
  try {
    await db.query(
      'INSERT INTO messages (chat_id, sender_type, sender_id, message_text) VALUES (?, ?, ?, ?)',
      [chat_id, sender_type, sender_id || null, message_text]
    );

    if (sender_type === 'agent') {
      await db.query(
        'UPDATE chats SET status = "active", first_response_at = COALESCE(first_response_at, NOW()), agent_id = COALESCE(agent_id, ?) WHERE id = ?',
        [sender_id, chat_id]
      );
    }

    // AI auto-reply
    if (sender_type === 'visitor') {
      const [rows] = await db.query(
        `SELECT c.chat_type, c.agent_id, ps.has_ai, b.id as business_id
         FROM chats c JOIN businesses b ON c.business_id = b.id
         JOIN plan_settings ps ON b.plan_key = ps.plan_key
         WHERE c.id = ?`, [chat_id]
      );
      if (rows.length && rows[0].has_ai && rows[0].chat_type === 'ai' && !rows[0].agent_id) {
        setImmediate(() => triggerAIReply(chat_id, message_text, rows[0].business_id));
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('sendMessage error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
};

// ─── GET MESSAGES ─────────────────────────────────────────────────────────────
exports.getChatMessages = async (req, res) => {
  try {
    const [messages] = await db.query(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY sent_at ASC', [req.params.chat_id]
    );
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get messages' });
  }
};

// ─── GET CHATS ────────────────────────────────────────────────────────────────
exports.getChats = async (req, res) => {
  const { status, limit = 50 } = req.query;
  const role = req.user.role;
  const business_id = req.user.business_id || req.user.id;
  const agent_id = req.user.id;
  try {
    let q = `
      SELECT c.id, c.chat_type, c.status, c.started_at, c.resolved_at, c.rating, c.rating_comment,
             c.current_page, c.first_response_at, c.agent_id,
             v.name as visitor_name, v.email as visitor_email, v.phone as visitor_phone,
             v.country, v.city, v.device_type, v.browser,
             a.name as agent_name,
             (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.is_read = 0 AND m.sender_type = 'visitor') as unread_count,
             (SELECT m2.message_text FROM messages m2 WHERE m2.chat_id = c.id ORDER BY m2.sent_at DESC LIMIT 1) as last_message
      FROM chats c
      LEFT JOIN visitors v ON c.visitor_id = v.id
      LEFT JOIN agents a ON c.agent_id = a.id
      WHERE c.business_id = ?`;
    const params = [business_id];

    if (role === 'agent') {
      if (status === 'resolved') {
        // History: show all resolved for the business (no agent filter)
        q += ' AND c.status = ?';
        params.push('resolved');
      } else {
        // Live tab: show open + active chats assigned to this agent
        q += ' AND c.status IN (?, ?) AND c.agent_id = ?';
        params.push('open', 'active', agent_id);
      }
    } else {
      // Business or main_agent - filter by status if provided
      if (status) { q += ' AND c.status = ?'; params.push(status); }
    }
    q += ' ORDER BY c.started_at DESC LIMIT ?';
    params.push(parseInt(limit));
    const [rows] = await db.query(q, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getChats error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get chats' });
  }
};

// ─── RESOLVE CHAT ─────────────────────────────────────────────────────────────
exports.resolveChat = async (req, res) => {
  try {
    await db.query('UPDATE chats SET status = "resolved", resolved_at = NOW() WHERE id = ?', [req.params.chat_id]);
    if (global.io) global.io.to(`chat:${req.params.chat_id}`).emit('chat:resolved', { chat_id: req.params.chat_id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to resolve' });
  }
};

// ─── RATE CHAT ────────────────────────────────────────────────────────────────
exports.rateChat = async (req, res) => {
  try {
    await db.query('UPDATE chats SET rating = ?, rating_comment = ? WHERE id = ?',
      [req.body.rating, req.body.comment || null, req.params.chat_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Rating failed' });
  }
};

// ─── ADD NOTE ─────────────────────────────────────────────────────────────────
exports.addNote = async (req, res) => {
  try {
    await db.query('INSERT INTO agent_notes (chat_id, agent_id, note_text) VALUES (?, ?, ?)',
      [req.params.chat_id, req.user.id, req.body.note_text]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add note' });
  }
};

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
exports.getAnalytics = async (req, res) => {
  const business_id = req.user.id;
  try {
    const [[total]]     = await db.query('SELECT COUNT(*) as c FROM chats WHERE business_id = ?', [business_id]);
    const [[today]]     = await db.query('SELECT COUNT(*) as c FROM chats WHERE business_id = ? AND DATE(started_at) = CURDATE()', [business_id]);
    const [[resolved]]  = await db.query('SELECT COUNT(*) as c FROM chats WHERE business_id = ? AND status = "resolved"', [business_id]);
    const [[missed]]    = await db.query('SELECT COUNT(*) as c FROM chats WHERE business_id = ? AND status = "missed"', [business_id]);
    const [[avgRating]] = await db.query('SELECT ROUND(AVG(rating),1) as avg FROM chats WHERE business_id = ? AND rating IS NOT NULL', [business_id]);
    const [countries]   = await db.query('SELECT v.country, COUNT(*) as count FROM chats c JOIN visitors v ON c.visitor_id = v.id WHERE c.business_id = ? AND v.country IS NOT NULL GROUP BY v.country ORDER BY count DESC LIMIT 5', [business_id]);
    const [agentPerf]   = await db.query('SELECT a.name, COUNT(c.id) as chats_handled FROM agents a LEFT JOIN chats c ON c.agent_id = a.id AND c.business_id = ? WHERE a.business_id = ? GROUP BY a.id, a.name', [business_id, business_id]);
    const [daily]       = await db.query('SELECT DATE(started_at) as date, COUNT(*) as count FROM chats WHERE business_id = ? AND started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY DATE(started_at) ORDER BY date ASC', [business_id]);
    const [[biz]]       = await db.query('SELECT b.chats_used_this_month, ps.max_chats_per_month as max_chats FROM businesses b JOIN plan_settings ps ON b.plan_key = ps.plan_key WHERE b.id = ?', [business_id]);
    res.json({ success: true, data: {
      total_chats: total.c, today_chats: today.c,
      resolved_chats: resolved.c, missed_chats: missed.c,
      avg_rating: avgRating.avg, top_countries: countries,
      agent_performance: agentPerf, daily_chats: daily,
      chats_used_this_month: biz?.chats_used_this_month || 0,
      max_chats_per_month: biz?.max_chats || null
    }});
  } catch (err) {
    console.error('Analytics error:', err.message);
    res.status(500).json({ success: false, message: 'Analytics failed' });
  }
};