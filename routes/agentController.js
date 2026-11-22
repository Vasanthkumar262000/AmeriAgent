const bcrypt = require('bcryptjs');
const db = require('../config/db');

// ─── GET ALL AGENTS (Business Admin) ─────────────────────────────────────────
exports.getAgents = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, role, is_active, online_status, last_seen_at, avatar_url, created_at
       FROM agents WHERE business_id = ? ORDER BY role DESC, name ASC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch agents' });
  }
};

// ─── ADD AGENT ────────────────────────────────────────────────────────────────
exports.addAgent = async (req, res) => {
  const { name, email, password, role } = req.body;
  const business_id = req.user.id;

  try {
    // Check agent limit based on plan
    const [plan] = await db.query(
      `SELECT ps.max_agents FROM businesses b
       JOIN plan_settings ps ON b.plan_key = ps.plan_key
       WHERE b.id = ?`,
      [business_id]
    );
    const [currentAgents] = await db.query(
      'SELECT COUNT(*) as count FROM agents WHERE business_id = ?',
      [business_id]
    );

    const maxAgents = plan[0]?.max_agents || 2;
    if (currentAgents[0].count >= maxAgents) {
      return res.status(400).json({ 
        success: false, 
        message: `Agent limit reached. Your plan allows ${maxAgents} agents. Please upgrade your plan to add more agents.`
      });
    }

    // Check email unique within business
    const [existing] = await db.query(
      'SELECT id FROM agents WHERE business_id = ? AND email = ?',
      [business_id, email]
    );
    if (existing.length) return res.status(400).json({ success: false, message: 'Agent with this email already exists' });

    const password_hash = await bcrypt.hash(password, 12);
    const [result] = await db.query(
      'INSERT INTO agents (business_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [business_id, name, email, password_hash, role || 'agent']
    );

    res.status(201).json({ success: true, message: 'Agent added successfully', data: { id: result.insertId, name, email, role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to add agent' });
  }
};

// ─── UPDATE AGENT ─────────────────────────────────────────────────────────────
exports.updateAgent = async (req, res) => {
  const { agent_id } = req.params;
  const { name, role, is_active } = req.body;
  try {
    await db.query(
      'UPDATE agents SET name = ?, role = ?, is_active = ? WHERE id = ? AND business_id = ?',
      [name, role, is_active, agent_id, req.user.id]
    );
    res.json({ success: true, message: 'Agent updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
};

// ─── DELETE AGENT ─────────────────────────────────────────────────────────────
exports.deleteAgent = async (req, res) => {
  const { agent_id } = req.params;
  try {
    await db.query(
      'UPDATE agents SET is_active = 0 WHERE id = ? AND business_id = ?',
      [agent_id, req.user.id]
    );
    res.json({ success: true, message: 'Agent deactivated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
};

// ─── RESET AGENT PASSWORD (Super Admin or Main Agent) ────────────────────────
exports.resetAgentPassword = async (req, res) => {
  const { agent_id } = req.params;
  const { new_password } = req.body;
  try {
    const password_hash = await bcrypt.hash(new_password, 12);
    await db.query(
      'UPDATE agents SET password_hash = ?, forgot_password_requested = 0 WHERE id = ?',
      [password_hash, agent_id]
    );
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Reset failed' });
  }
};

// ─── UPDATE AGENT STATUS ──────────────────────────────────────────────────────
exports.updateStatus = async (req, res) => {
  const { status } = req.body;
  try {
    await db.query(
      'UPDATE agents SET online_status = ?, last_seen_at = NOW() WHERE id = ?',
      [status, req.user.id]
    );
    res.json({ success: true, message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Status update failed' });
  }
};
