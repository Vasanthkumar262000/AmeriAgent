const express = require('express');
const router = express.Router();
const agentCtrl = require('../controllers/agentController');
const authMiddleware = require('../middleware/auth');

router.get('/', authMiddleware(['business']), agentCtrl.getAgents);
router.post('/', authMiddleware(['business']), agentCtrl.addAgent);
router.put('/:agent_id', authMiddleware(['business']), agentCtrl.updateAgent);
router.delete('/:agent_id', authMiddleware(['business']), agentCtrl.deleteAgent);
router.put('/:agent_id/reset-password', authMiddleware(['super_admin', 'business']), agentCtrl.resetAgentPassword);
// Handle both JSON and text/plain (sendBeacon sends text/plain)
router.put('/status/update', (req, res, next) => {
  if (req.headers['content-type']?.includes('text/plain') && typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch(e) {}
  }
  next();
}, authMiddleware(['agent', 'main_agent']), agentCtrl.updateStatus);

// Get my current status
router.get('/my-status', authMiddleware(['agent', 'main_agent']), async (req, res) => {
  try {
    const db = require('../config/db');
    const [[agent]] = await db.query('SELECT online_status FROM agents WHERE id = ?', [req.user.id]);
    res.json({ success: true, status: agent?.online_status || 'offline' });
  } catch(err) {
    res.json({ success: true, status: 'offline' });
  }
});

module.exports = router;