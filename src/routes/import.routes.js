const fs = require('fs');
const crypto = require('crypto');
const db = require('../config/database');
const { importLimiter } = require('../middleware/rateLimiter');
const { requireAuth, requireModule } = require('../middleware/auth');
const { logActivity } = require('../services/activity');

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function register(app, upload) {
  const XLSX = require('xlsx');

  app.post('/api/import', requireAuth, requireModule('import'), importLimiter, upload.single('file'), async (req, res) => {
    try {
      const module = String(req.body.module || '').trim().toLowerCase();
      if (!['doctors', 'patients'].includes(module)) {
        return res.status(400).json({ error: 'invalid_module', message: 'Supported modules: doctors, patients' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'file_required' });
      }

      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

      if (!rawRows || !rawRows.length) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'file_empty', message: 'No data rows found' });
      }

      const rows = rawRows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase().trim(), v])));
      const headers = Object.keys(rows[0]);
      let expectedHeaders;
      if (module === 'doctors') {
        expectedHeaders = ['name', 'department', 'email'];
      } else {
        expectedHeaders = ['name', 'phone'];
      }

      const missingHeaders = expectedHeaders.filter(h => !headers.includes(h));
      if (missingHeaders.length) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          error: 'missing_columns',
          message: 'Missing required columns: ' + missingHeaders.join(', ')
        });
      }

      const results = { total: rows.length, created: 0, updated: 0, errors: [] };

      if (module === 'doctors') {
        const allNames = rows.map(r => String(r['name'] || '').trim().toLowerCase()).filter(Boolean);
        const existingMap = new Map();
        if (allNames.length) {
          const placeholders = allNames.map((_, i) => '$' + (i + 1)).join(',');
          const existing = await db.query(
            `SELECT id, LOWER(name) AS name FROM doctors WHERE LOWER(name) IN (${placeholders})`,
            allNames
          );
          for (const row of existing.rows) existingMap.set(row.name, row.id);
        }

        const toInsert = [];
        for (const row of rows) {
          const name = String(row['name'] || '').trim();
          if (!name) {
            results.errors.push({ row: results.created + results.updated + results.errors.length + 1, error: 'name_required' });
            continue;
          }

          if (existingMap.has(name.toLowerCase())) {
            const id = existingMap.get(name.toLowerCase());
            try {
              await db.query(
                'UPDATE doctors SET name = $1, department = $2, email = $3, updated_at = NOW() WHERE id = $4',
                [name, String(row['department'] || '').trim() || null, String(row['email'] || '').trim() || null, id]
              );
              results.updated++;
            } catch (e) {
              results.errors.push({ row: results.created + results.updated + results.errors.length + 1, error: e.message });
            }
          } else {
            toInsert.push({
              id: makeId('D'),
              name,
              department: String(row['department'] || '').trim() || null,
              email: String(row['email'] || '').trim() || null
            });
          }
        }

        for (const batch of chunkArray(toInsert, 50)) {
          const valueClauses = [];
          const params = [];
          let idx = 1;
          for (const doc of batch) {
            valueClauses.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
            params.push(doc.id, doc.name, doc.department, doc.email);
            idx += 4;
          }
          try {
            await db.query(
              `INSERT INTO doctors (id, name, department, email) VALUES ${valueClauses.join(', ')}`,
              params
            );
            results.created += batch.length;
          } catch (e) {
            results.errors.push({ row: results.errors.length + 1, error: 'batch_insert_failed: ' + e.message });
          }
        }
      } else {
        const allPhones = rows.map(r => String(r['phone'] || '').trim()).filter(Boolean);
        const existingMap = new Map();
        if (allPhones.length) {
          const placeholders = allPhones.map((_, i) => '$' + (i + 1)).join(',');
          const existing = await db.query(
            `SELECT id, phone FROM patients WHERE phone IN (${placeholders})`,
            allPhones
          );
          for (const row of existing.rows) existingMap.set(row.phone, row.id);
        }

        const toInsert = [];
        for (const row of rows) {
          const name = String(row['name'] || '').trim();
          const phone = String(row['phone'] || '').trim();
          if (!name) {
            results.errors.push({ row: results.created + results.updated + results.errors.length + 1, error: 'name_required' });
            continue;
          }
          if (!phone) {
            results.errors.push({ row: results.created + results.updated + results.errors.length + 1, error: 'phone_required' });
            continue;
          }

          if (existingMap.has(phone)) {
            const id = existingMap.get(phone);
            try {
              await db.query(
                'UPDATE patients SET name = $1, phone = $2, updated_at = NOW() WHERE id = $3',
                [name, phone, id]
              );
              results.updated++;
            } catch (e) {
              results.errors.push({ row: results.created + results.updated + results.errors.length + 1, error: e.message });
            }
          } else {
            toInsert.push({ id: makeId('P'), name, phone });
          }
        }

        for (const batch of chunkArray(toInsert, 50)) {
          const valueClauses = [];
          const params = [];
          let idx = 1;
          for (const pat of batch) {
            valueClauses.push(`($${idx}, $${idx + 1}, $${idx + 2})`);
            params.push(pat.id, pat.name, pat.phone);
            idx += 3;
          }
          try {
            await db.query(
              `INSERT INTO patients (id, name, phone) VALUES ${valueClauses.join(', ')}`,
              params
            );
            results.created += batch.length;
          } catch (e) {
            results.errors.push({ row: results.errors.length + 1, error: 'batch_insert_failed: ' + e.message });
          }
        }
      }

      fs.unlink(req.file.path, () => {});
      await logActivity(req.adminUser.id, 'import_' + module, { total: results.total, created: results.created, updated: results.updated, errors: results.errors.length });

      return res.json(results);
    } catch (e) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(500).json({ error: 'import_failed' });
    }
  });
}

module.exports = { register };
