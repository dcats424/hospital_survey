const db = require('../db');

function validateEmail(email) {
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim() : false;
}

function makeId(prefix) {
  const crypto = require('crypto');
  return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

async function getAllDoctors(statusFilter = 'active') {
  const where = statusFilter ? 'WHERE status = $1' : '';
  const values = statusFilter ? [statusFilter] : [];
  const result = await db.query(
    `SELECT id, name, department, email, image_url, status, created_at 
     FROM doctors ${where} ORDER BY name ASC`,
    values
  );
  return result.rows;
}

async function getDoctorsPaginated({ search = '', page = 1, limit = 10, status = 'all' }) {
  const offset = (page - 1) * limit;
  const searchPattern = '%' + search.toLowerCase() + '%';
  const conditions = [];
  const values = [];
  let idx = 1;

  if (search) {
    conditions.push(`(LOWER(name) LIKE $${idx} OR LOWER(id) LIKE $${idx})`);
    values.push(searchPattern);
    idx++;
  }
  if (status === 'active') {
    conditions.push(`status = $${idx}`);
    values.push('active');
    idx++;
  } else if (status === 'left') {
    conditions.push(`status = $${idx}`);
    values.push('left');
    idx++;
  } else if (status === 'suspended') {
    conditions.push(`status = $${idx}`);
    values.push('suspended');
    idx++;
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countResult = await db.query(
    `SELECT COUNT(*) as total FROM doctors ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].total);

  values.push(limit, offset);
  const result = await db.query(
    `SELECT id, name, department, email, image_url, status, created_at 
     FROM doctors 
     ${whereClause}
     ORDER BY 
       CASE status WHEN 'active' THEN 1 WHEN 'suspended' THEN 2 WHEN 'left' THEN 3 END,
       name ASC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    values
  );

  return {
    doctors: result.rows,
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit)
  };
}

async function getDoctorById(id) {
  const result = await db.query('SELECT * FROM doctors WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function createDoctor({ name, department, email, image_url }) {
  if (!name || !name.trim()) {
    throw new Error('doctor_name_required');
  }
  const trimmedName = name.trim();
  if (trimmedName.length < 2) throw new Error('doctor_name_too_short');
  if (trimmedName.length > 100) throw new Error('doctor_name_too_long');

  let normalizedEmail = null;
  if (email) {
    normalizedEmail = validateEmail(email);
    if (normalizedEmail === false) throw new Error('invalid_email_format');
  }

  const dept = department ? department.trim().slice(0, 100) : null;

  const id = makeId('D');
  try {
    const result = await db.query(
      `INSERT INTO doctors (id, name, department, email, image_url) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [id, trimmedName, dept, normalizedEmail, image_url || null]
    );
    return result.rows[0];
  } catch (e) {
    if (e.code === '23505') throw new Error('duplicate_email');
    throw e;
  }
}

async function updateDoctor(id, { name, department, email, status, image_url }) {
  const updates = [];
  const values = [];
  let idx = 1;
  
  if (name !== undefined) {
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new Error('doctor_name_too_short');
    if (trimmed.length > 100) throw new Error('doctor_name_too_long');
    updates.push(`name = $${idx++}`);
    values.push(trimmed);
  }
  if (department !== undefined) {
    updates.push(`department = $${idx++}`);
    values.push(department ? department.trim().slice(0, 100) : null);
  }
  if (email !== undefined) {
    if (email) {
      const validated = validateEmail(email);
      if (validated === false) throw new Error('invalid_email_format');
      updates.push(`email = $${idx++}`);
      values.push(validated);
    } else {
      updates.push(`email = $${idx++}`);
      values.push(null);
    }
  }
  if (status !== undefined) {
    updates.push(`status = $${idx++}`);
    values.push(status);
  }
  if (image_url !== undefined) {
    updates.push(`image_url = $${idx++}`);
    values.push(image_url || null);
  }
  updates.push(`updated_at = NOW()`);
  values.push(id);
  
  try {
    const result = await db.query(
      `UPDATE doctors SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  } catch (e) {
    if (e.code === '23505') throw new Error('duplicate_email');
    throw e;
  }
}

async function deleteDoctor(id) {
  const linkCheck = await db.query(
    `SELECT
      (SELECT COUNT(*) FROM encounter_doctors WHERE doctor_id = $1) AS encounters,
      (SELECT COUNT(*) FROM feedback_ratings WHERE doctor_id = $1) AS ratings`,
    [id]
  );
  const { encounters, ratings } = linkCheck.rows[0];
  if (Number(encounters) > 0 || Number(ratings) > 0) {
    const parts = [];
    if (Number(encounters) > 0) parts.push(encounters + ' encounter(s)');
    if (Number(ratings) > 0) parts.push(ratings + ' response(s)');
    throw new Error('has_associated_data:' + parts.join(' and '));
  }
  const result = await db.query('DELETE FROM doctors WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

async function permanentlyDeleteDoctor(id) {
  const result = await db.query('DELETE FROM doctors WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

async function updateDoctorStatus(id, status) {
  const valid = ['active', 'left', 'suspended'];
  if (!valid.includes(status)) throw new Error('invalid_status');
  const result = await db.query(
    'UPDATE doctors SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [id, status]
  );
  return result.rows[0] || null;
}

module.exports = { getAllDoctors, getDoctorsPaginated, getDoctorById, createDoctor, updateDoctor, deleteDoctor, permanentlyDeleteDoctor, updateDoctorStatus };
