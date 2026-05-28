const crypto = require('crypto');
const db = require('./database');
const {
  ensureAdminUsersTable, ensureSessionsTable, ensureRolesTables,
  ensureRoleColumnOnUsers, ensureDoctorsTableColumns,
  ensurePatientsTableConstraints, ensureNotificationsTable,
  ensureEncountersSurveySentColumn, ensureQuestionsTableAndDefaults,
  ensureEmailSettingsTable, ensureActivityLogsTable, seedDefaultRoles,
  ensureIndexes, loadSessions
} = require('../services/bootstrap');

async function boot(app, PORT, BASE_URL) {
  await ensureQuestionsTableAndDefaults();
  await ensureAdminUsersTable();
  await ensureActivityLogsTable();
  await ensureSessionsTable();
  await ensureRolesTables();
  await ensureRoleColumnOnUsers();
  await ensureDoctorsTableColumns();
  await ensurePatientsTableConstraints();
  await ensureNotificationsTable();
  await ensureEmailSettingsTable();
  await ensureEncountersSurveySentColumn();
  await seedDefaultRoles();
  await ensureIndexes();

  const sessionsMap = await loadSessions();

  setInterval(async () => {
    await db.query(`DELETE FROM admin_sessions WHERE expires_at < NOW()`);
    const now = new Date();
    for (const [token, session] of sessionsMap) {
      if (session.expires_at && new Date(session.expires_at) < now) {
        sessionsMap.delete(token);
      }
    }
  }, 15 * 60 * 1000);

  app.listen(PORT, function () {
    console.log('Server running at ' + BASE_URL);
  });
}

module.exports = { boot };
