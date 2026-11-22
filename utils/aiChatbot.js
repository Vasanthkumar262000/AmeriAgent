const db = require('../config/db');

// ─── KEYWORD-BASED AI CHATBOT ─────────────────────────────────────────────────
exports.getAIReply = async (chatId, visitorMessage, businessId) => {
  try {
    // Get bot settings
    const [[settings]] = await db.query(
      'SELECT * FROM ai_bot_settings WHERE business_id = ? AND bot_enabled = 1',
      [businessId]
    );

    if (!settings) return null; // Bot disabled

    // Check operating hours
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    if (settings.start_time && settings.end_time) {
      const [startH, startM] = settings.start_time.split(':').map(Number);
      const [endH, endM] = settings.end_time.split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;

      if (currentTime < startMins || currentTime > endMins) {
        // Outside hours
        return settings.outside_hours_message || 'We are closed. We will reply soon!';
      }
    }

    // Get active keywords
    const [keywords] = await db.query(
      'SELECT * FROM ai_bot_keywords WHERE business_id = ? AND is_active = 1 ORDER BY id ASC',
      [businessId]
    );

    const msgLower = visitorMessage.toLowerCase().trim();

    // Match keywords
    for (const kw of keywords) {
      const kwLower = kw.keyword.toLowerCase().trim();
      let matched = false;

      if (kw.match_type === 'exact') {
        matched = msgLower === kwLower;
      } else if (kw.match_type === 'starts_with') {
        matched = msgLower.startsWith(kwLower);
      } else {
        // contains (default)
        matched = msgLower.includes(kwLower);
      }

      if (matched) {
        // Update used count
        await db.query(
          'UPDATE ai_bot_keywords SET used_count = used_count + 1 WHERE id = ?',
          [kw.id]
        );
        return kw.reply;
      }
    }

    // No keyword matched - return fallback
    return settings.fallback_message || 'I am not sure about that. Please wait for an agent.';

  } catch (err) {
    console.error('AI keyword bot error:', err.message);
    return null;
  }
};