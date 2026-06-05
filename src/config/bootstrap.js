const db = require('./database');
const { loadSessions } = require('../middleware/auth');

async function boot(server, PORT, BASE_URL) {
  await loadSessions();

  setInterval(async () => {
    await db.query(`DELETE FROM admin_sessions WHERE expires_at < NOW()`);
  }, 15 * 60 * 1000);

  server.listen(PORT, function () {
    console.log('Server running at ' + BASE_URL);
  });
}

module.exports = { boot };
