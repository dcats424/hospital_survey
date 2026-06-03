const db = require('../config/database');
const { requireAuth, requireModule } = require('../middleware/auth');
const { getAnalyticsData } = require('../services/reportMetrics');

function register(app) {
  app.get('/api/analytics', requireAuth, requireModule('dashboard'), async function (req, res) {
    try {
      const data = await getAnalyticsData({
        dateFrom: String(req.query.date_from || '').trim(),
        dateTo: String(req.query.date_to || '').trim()
      });
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'analytics_failed' });
    }
  });

  app.get('/api/reports/survey-stats', requireAuth, requireModule('reports'), async function (req, res) {
    try {
      const { date_from, date_to } = req.query;
      const conditions = [];
      const params = [];
      let idx = 1;

      if (date_from) {
        conditions.push(`st.created_at >= $${idx}::timestamptz`);
        params.push(date_from + 'T00:00:00.000Z');
        idx++;
      }
      if (date_to) {
        conditions.push(`st.created_at <= $${idx}::timestamptz`);
        params.push(date_to + 'T23:59:59.999Z');
        idx++;
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const result = await db.query(
        `SELECT
          COUNT(*) AS total_sent,
          COUNT(*) FILTER (WHERE st.used_at IS NOT NULL) AS filled,
          COUNT(*) FILTER (WHERE st.used_at IS NULL) AS not_filled
        FROM survey_tokens st
        JOIN encounters e ON e.survey_token = st.token
        ${whereClause}`,
        params
      );

      return res.json({
        total_sent: parseInt(result.rows[0].total_sent),
        filled: parseInt(result.rows[0].filled),
        not_filled: parseInt(result.rows[0].not_filled)
      });
    } catch (e) {
      return res.status(500).json({ error: 'survey_stats_failed' });
    }
  });
}

module.exports = { register };
