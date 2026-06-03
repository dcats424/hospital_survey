const db = require('../config/database');

const DEFAULT_REPORT_LIMIT = 500;
const MAX_REPORT_LIMIT = 5000;
const DEFAULT_EXPORT_LIMIT = 5000;

function toDateStart(value) {
  return value ? String(value).trim() + 'T00:00:00.000Z' : '';
}

function toDateEnd(value) {
  return value ? String(value).trim() + 'T23:59:59.999Z' : '';
}

function buildSubmissionFilter({ dateFrom = '', dateTo = '' } = {}, alias = 'fs') {
  const conditions = [];
  const params = [];

  if (dateFrom) {
    params.push(toDateStart(dateFrom));
    conditions.push(`${alias}.submitted_at >= $${params.length}::timestamptz`);
  }

  if (dateTo) {
    params.push(toDateEnd(dateTo));
    conditions.push(`${alias}.submitted_at <= $${params.length}::timestamptz`);
  }

  return {
    whereClause: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '',
    params
  };
}

function normalizePagination(page, limit, defaults = {}) {
  const maxLimit = defaults.maxLimit || MAX_REPORT_LIMIT;
  const defaultLimit = defaults.defaultLimit || DEFAULT_REPORT_LIMIT;
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(maxLimit, Math.max(1, parseInt(limit, 10) || defaultLimit));
  return {
    page: safePage,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit
  };
}

function getDoctorAnswersCte(whereClause) {
  return `
    WITH base_submissions AS (
      SELECT fs.id, fs.selected_doctor_ids, fs.selected_doctor_names, fs.question_answers
      FROM feedback_submissions fs
      ${whereClause}
    ),
    raw_doctor_answers AS (
      SELECT
        fs.id AS submission_id,
        substring(answer.key FROM '^doctor_([^_]+)_') AS doctor_id,
        substring(answer.key FROM '^doctor_[^_]+_(.+)$') AS question_key,
        fs.selected_doctor_ids,
        fs.selected_doctor_names,
        answer.value AS answer_json,
        answer.value #>> '{}' AS answer_text
      FROM base_submissions fs
      CROSS JOIN LATERAL jsonb_each(COALESCE(fs.question_answers, '{}'::jsonb)) AS answer(key, value)
      WHERE answer.key ~ '^doctor_[^_]+_.+$'
    ),
    doctor_answers AS (
      SELECT
        submission_id,
        doctor_id,
        question_key,
        COALESCE(selected_doctor_names[array_position(selected_doctor_ids, doctor_id)], doctor_id) AS doctor_name,
        answer_json,
        answer_text
      FROM raw_doctor_answers
      WHERE doctor_id IS NOT NULL AND question_key IS NOT NULL
    ),
    normalized_answers AS (
      SELECT
        da.*,
        sq.type,
        CASE
          WHEN jsonb_typeof(da.answer_json) = 'number'
            THEN (da.answer_json #>> '{}')::numeric
          ELSE NULL
        END AS numeric_value
      FROM doctor_answers da
      JOIN survey_questions sq
        ON sq.question_key = da.question_key
       AND sq.category = 'doctor'
       AND sq.is_active = TRUE
       AND sq.is_deleted = FALSE
    )
  `;
}

function prefixDoctorName(name) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  return /^dr\.?\s/i.test(clean) ? clean : 'Dr. ' + clean;
}

function normalizeDoctorNameForMatch(name) {
  return String(name || '').replace(/^Dr\.?\s*/i, '').trim().toLowerCase();
}

async function getDoctorEmailMap(ratings) {
  if (!ratings.length) return {};

  const doctorIds = new Set(ratings.map((rating) => rating.doctor_id));
  const doctorNames = new Map();
  for (const rating of ratings) {
    const normalized = normalizeDoctorNameForMatch(rating.doctor_name);
    if (normalized) doctorNames.set(normalized, rating.doctor_id);
  }

  const emailRows = await db.query('SELECT id, name, email FROM doctors WHERE email IS NOT NULL AND email <> $1', ['']);
  const emailByDoctor = {};

  for (const row of emailRows.rows) {
    if (doctorIds.has(row.id)) {
      emailByDoctor[row.id] = row.email;
      continue;
    }

    const normalized = normalizeDoctorNameForMatch(row.name);
    const matchedId = doctorNames.get(normalized);
    if (matchedId && !emailByDoctor[matchedId]) {
      emailByDoctor[matchedId] = row.email;
    }
  }

  return emailByDoctor;
}

async function getDoctorMetrics({ dateFrom = '', dateTo = '', doctorName = '', page, limit, includeEmails = false } = {}) {
  const filter = buildSubmissionFilter({ dateFrom, dateTo });
  const doctorCte = getDoctorAnswersCte(filter.whereClause);
  const doctorFilter = String(doctorName || '').trim().toLowerCase();

  const summarySql = `
    ${doctorCte},
    doctor_submissions AS (
      SELECT DISTINCT doctor_id, doctor_name, submission_id
      FROM normalized_answers
    ),
    patient_numeric_averages AS (
      SELECT doctor_id, doctor_name, submission_id, AVG(numeric_value) AS patient_average
      FROM normalized_answers
      WHERE type <> 'yes_no'
        AND numeric_value >= 1
        AND numeric_value <= 5
      GROUP BY doctor_id, doctor_name, submission_id
    )
    SELECT
      ds.doctor_id,
      ds.doctor_name,
      COUNT(DISTINCT ds.submission_id)::int AS patient_count,
      COALESCE(SUM(pna.patient_average) / NULLIF(COUNT(DISTINCT ds.submission_id), 0), 0)::float AS average_rating,
      COUNT(*) FILTER (WHERE ROUND(pna.patient_average) = 5)::int AS five_star,
      COUNT(*) FILTER (WHERE ROUND(pna.patient_average) = 4)::int AS four_star,
      COUNT(*) FILTER (WHERE ROUND(pna.patient_average) = 3)::int AS three_star,
      COUNT(*) FILTER (WHERE ROUND(pna.patient_average) = 2)::int AS two_star,
      COUNT(*) FILTER (WHERE ROUND(pna.patient_average) = 1)::int AS one_star
    FROM doctor_submissions ds
    LEFT JOIN patient_numeric_averages pna
      ON pna.doctor_id = ds.doctor_id
     AND pna.doctor_name = ds.doctor_name
     AND pna.submission_id = ds.submission_id
    GROUP BY ds.doctor_id, ds.doctor_name
    ORDER BY ds.doctor_name ASC
  `;

  const questionSql = `
    ${doctorCte}
    SELECT
      na.doctor_id,
      na.doctor_name,
      na.question_key,
      na.type,
      COALESCE(AVG(na.numeric_value) FILTER (
        WHERE na.type <> 'yes_no' AND na.numeric_value >= 1 AND na.numeric_value <= 5
      ), 0)::float AS average,
      COUNT(*) FILTER (
        WHERE (
          na.type = 'yes_no' AND lower(na.answer_text) IN ('yes', 'no')
        ) OR (
          na.type <> 'yes_no' AND na.numeric_value >= 1 AND na.numeric_value <= 5
        )
      )::int AS count,
      COUNT(*) FILTER (WHERE na.type = 'yes_no' AND lower(na.answer_text) = 'yes')::int AS yes_count,
      COUNT(*) FILTER (WHERE na.type = 'yes_no' AND lower(na.answer_text) = 'no')::int AS no_count,
      MIN(sq.page_number) AS page_number,
      MIN(sq.order_no) AS order_no,
      MIN(sq.id) AS question_id
    FROM normalized_answers na
    JOIN survey_questions sq
      ON sq.question_key = na.question_key
     AND sq.category = 'doctor'
     AND sq.is_active = TRUE
     AND sq.is_deleted = FALSE
    GROUP BY na.doctor_id, na.doctor_name, na.question_key, na.type
    HAVING COUNT(*) FILTER (
      WHERE (
        na.type = 'yes_no' AND lower(na.answer_text) IN ('yes', 'no')
      ) OR (
        na.type <> 'yes_no' AND na.numeric_value >= 1 AND na.numeric_value <= 5
      )
    ) > 0
    ORDER BY page_number ASC, order_no ASC, question_id ASC
  `;

  const [summaryResult, questionResult] = await Promise.all([
    db.query(summarySql, filter.params),
    db.query(questionSql, filter.params)
  ]);

  const questionRatingsByDoctor = new Map();
  for (const row of questionResult.rows) {
    const key = row.doctor_id + '\u0000' + row.doctor_name;
    if (!questionRatingsByDoctor.has(key)) questionRatingsByDoctor.set(key, []);
    questionRatingsByDoctor.get(key).push({
      question_key: row.question_key,
      type: row.type,
      average: Number(row.average) || 0,
      count: Number(row.count) || 0,
      yes_count: Number(row.yes_count) || 0,
      no_count: Number(row.no_count) || 0
    });
  }

  let ratings = summaryResult.rows.map((row) => {
    const doctorNameValue = prefixDoctorName(row.doctor_name || row.doctor_id);
    const questionRatings = questionRatingsByDoctor.get(row.doctor_id + '\u0000' + row.doctor_name) || [];
    return {
      doctor_id: row.doctor_id,
      doctor_name: doctorNameValue,
      department: 'General',
      patient_count: Number(row.patient_count) || 0,
      total_patients: Number(row.patient_count) || 0,
      average_rating: Number(row.average_rating) || 0,
      five_star: Number(row.five_star) || 0,
      four_star: Number(row.four_star) || 0,
      three_star: Number(row.three_star) || 0,
      two_star: Number(row.two_star) || 0,
      one_star: Number(row.one_star) || 0,
      question_ratings: questionRatings
    };
  });

  if (doctorFilter) {
    ratings = ratings.filter((rating) => (
      rating.doctor_name.toLowerCase().includes(doctorFilter) ||
      String(rating.doctor_id || '').toLowerCase().includes(doctorFilter)
    ));
  }

  ratings.sort((a, b) => a.doctor_name.localeCompare(b.doctor_name));

  const total = ratings.length;
  if (page !== undefined || limit !== undefined) {
    const pagination = normalizePagination(page, limit);
    ratings = ratings.slice(pagination.offset, pagination.offset + pagination.limit);
  }

  if (includeEmails) {
    const emailByDoctor = await getDoctorEmailMap(ratings);
    ratings = ratings.map((rating) => ({
      ...rating,
      email: emailByDoctor[rating.doctor_id] || ''
    }));
  }

  return { ratings, total };
}

async function getGeneralMetrics({ dateFrom = '', dateTo = '' } = {}) {
  const filter = buildSubmissionFilter({ dateFrom, dateTo });
  const sql = `
    WITH base_submissions AS (
      SELECT fs.id, fs.question_answers
      FROM feedback_submissions fs
      ${filter.whereClause}
    ),
    normalized_answers AS (
      SELECT
        sq.question_key,
        sq.type,
        answer.value AS answer_json,
        answer.value #>> '{}' AS answer_text,
        CASE
          WHEN jsonb_typeof(answer.value) = 'number'
            THEN (answer.value #>> '{}')::numeric
          ELSE NULL
        END AS numeric_value,
        sq.page_number,
        sq.order_no,
        sq.id AS question_id
      FROM base_submissions fs
      CROSS JOIN LATERAL jsonb_each(COALESCE(fs.question_answers, '{}'::jsonb)) AS answer(key, value)
      JOIN survey_questions sq
        ON sq.question_key = answer.key
       AND sq.category = 'general'
       AND sq.is_active = TRUE
       AND sq.is_deleted = FALSE
    )
    SELECT
      question_key,
      type,
      COALESCE(AVG(numeric_value) FILTER (WHERE numeric_value >= 1 AND numeric_value <= 5), 0)::float AS average,
      COUNT(*) FILTER (WHERE numeric_value >= 1 AND numeric_value <= 5)::int AS numeric_count,
      COUNT(*) FILTER (WHERE numeric_value >= 4 AND numeric_value <= 5)::int AS numeric_satisfied,
      COUNT(*) FILTER (WHERE numeric_value = 3)::int AS numeric_neutral,
      COUNT(*) FILTER (WHERE numeric_value >= 1 AND numeric_value <= 2)::int AS numeric_not_satisfied,
      COALESCE(AVG(numeric_value) FILTER (WHERE numeric_value >= 4 AND numeric_value <= 5), 0)::float AS avg_satisfied,
      COALESCE(AVG(numeric_value) FILTER (WHERE numeric_value >= 1 AND numeric_value <= 2), 0)::float AS avg_not_satisfied,
      COUNT(*) FILTER (WHERE lower(answer_text) = 'yes')::int AS yes_count,
      COUNT(*) FILTER (WHERE lower(answer_text) = 'no')::int AS no_count,
      MIN(page_number) AS page_number,
      MIN(order_no) AS order_no,
      MIN(question_id) AS question_id
    FROM normalized_answers
    GROUP BY question_key, type
    ORDER BY page_number ASC, order_no ASC, question_id ASC
  `;

  const result = await db.query(sql, filter.params);
  return result.rows.map((row) => {
    const numericSatisfied = Number(row.numeric_satisfied) || 0;
    const numericNeutral = Number(row.numeric_neutral) || 0;
    const numericNotSatisfied = Number(row.numeric_not_satisfied) || 0;
    const yesCount = Number(row.yes_count) || 0;
    const noCount = Number(row.no_count) || 0;

    return {
      question_key: row.question_key,
      type: row.type,
      average: Number(row.average) || 0,
      numeric_count: Number(row.numeric_count) || 0,
      numeric_satisfied: numericSatisfied,
      numeric_neutral: numericNeutral,
      numeric_not_satisfied: numericNotSatisfied,
      avg_satisfied: Number(row.avg_satisfied) || 0,
      avg_not_satisfied: Number(row.avg_not_satisfied) || 0,
      yes_count: yesCount,
      no_count: noCount,
      satisfied: numericSatisfied + yesCount,
      neutral: numericNeutral,
      not_satisfied: numericNotSatisfied + noCount,
      total_responses: (Number(row.numeric_count) || 0) + yesCount + noCount
    };
  });
}

async function getSubmissionCount({ dateFrom = '', dateTo = '' } = {}) {
  const filter = buildSubmissionFilter({ dateFrom, dateTo });
  const result = await db.query(
    `SELECT COUNT(*)::int AS total FROM feedback_submissions fs ${filter.whereClause}`,
    filter.params
  );
  return Number(result.rows[0]?.total) || 0;
}

async function getReportData({ dateFrom = '', dateTo = '', doctorName = '', page, limit, includeEmails = false } = {}) {
  const pagination = normalizePagination(page, limit);
  const [doctorData, generalRows, totalSubmissions] = await Promise.all([
    getDoctorMetrics({ dateFrom, dateTo, doctorName, page: pagination.page, limit: pagination.limit, includeEmails }),
    getGeneralMetrics({ dateFrom, dateTo }),
    getSubmissionCount({ dateFrom, dateTo })
  ]);

  const generalSurvey = generalRows.map((row) => {
    if (row.type === 'yes_no') {
      const total = row.yes_count + row.no_count;
      return {
        question_key: row.question_key,
        type: row.type,
        yes_percentage: total > 0 ? Math.round((row.yes_count / total) * 100) : 0,
        yes_count: row.yes_count,
        no_count: row.no_count,
        total_responses: total
      };
    }

    return {
      question_key: row.question_key,
      type: row.type,
      average: row.numeric_count > 0 ? Number(row.average.toFixed(2)) : 0,
      total_responses: row.numeric_count
    };
  });

  return {
    doctors: doctorData.ratings,
    doctors_total: doctorData.total,
    general_survey: generalSurvey,
    total_submissions: totalSubmissions,
    page: pagination.page,
    limit: pagination.limit,
    total_pages: Math.ceil(doctorData.total / pagination.limit)
  };
}

async function getAnalyticsData({ dateFrom = '', dateTo = '' } = {}) {
  const filter = buildSubmissionFilter({ dateFrom, dateTo });
  const answerCountsSql = `
    ${getDoctorAnswersCte(filter.whereClause)}
    SELECT doctor_id, doctor_name, question_key, answer_text, COUNT(*)::int AS count
    FROM normalized_answers
    WHERE answer_text IS NOT NULL AND answer_text <> ''
    GROUP BY doctor_id, doctor_name, question_key, answer_text
  `;

  const [doctorData, generalRows, totalSubmissions, answerCountsResult] = await Promise.all([
    getDoctorMetrics({ dateFrom, dateTo }),
    getGeneralMetrics({ dateFrom, dateTo }),
    getSubmissionCount({ dateFrom, dateTo }),
    db.query(answerCountsSql, filter.params)
  ]);

  const answerStatsByDoctor = new Map();
  for (const row of answerCountsResult.rows) {
    const normalizedName = String(row.doctor_name || '').replace(/^Dr\.?\s*/i, '');
    const doctorKey = row.doctor_id + '\u0000' + normalizedName;
    if (!answerStatsByDoctor.has(doctorKey)) answerStatsByDoctor.set(doctorKey, {});
    const questionAnswers = answerStatsByDoctor.get(doctorKey);
    if (!questionAnswers[row.question_key]) {
      questionAnswers[row.question_key] = { counts: {}, total: 0 };
    }
    questionAnswers[row.question_key].counts[row.answer_text] = Number(row.count) || 0;
    questionAnswers[row.question_key].total += Number(row.count) || 0;
  }

  const doctorAverages = doctorData.ratings.map((doctor) => {
    const normalizedName = doctor.doctor_name.replace(/^Dr\.?\s*/i, '');
    const doctorKey = doctor.doctor_id + '\u0000' + normalizedName;
    const answerStats = answerStatsByDoctor.get(doctorKey) || {};
    const questionAnswers = {};

    for (const [questionKey, stats] of Object.entries(answerStats)) {
      const percentages = {};
      for (const [answer, count] of Object.entries(stats.counts)) {
        percentages[answer] = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
      }
      questionAnswers[questionKey] = {
        counts: stats.counts,
        percentages,
        total: stats.total
      };
    }

    const questionRatings = {};
    let ratingCount = 0;
    for (const rating of doctor.question_ratings) {
      if (rating.type !== 'yes_no' && rating.count > 0) {
        questionRatings[rating.question_key] = Math.round((rating.average || 0) * 100) / 100;
        ratingCount += rating.count;
      }
    }

    return {
      doctor_id: doctor.doctor_id,
      doctor_name: doctor.doctor_name.replace(/^Dr\.?\s*/i, ''),
      avg_rating: doctor.average_rating > 0 ? Math.round(doctor.average_rating * 100) / 100 : null,
      rating_count: ratingCount,
      patient_count: doctor.patient_count,
      question_ratings: questionRatings,
      question_answers: questionAnswers
    };
  }).sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0));

  let generalSatisfied = 0;
  let generalNeutral = 0;
  let generalNotSatisfied = 0;

  const questionBreakdown = generalRows.map((row) => {
    generalSatisfied += row.satisfied;
    generalNeutral += row.neutral;
    generalNotSatisfied += row.not_satisfied;

    const total = row.satisfied + row.neutral + row.not_satisfied;
    const avgSatisfied = row.avg_satisfied || (row.satisfied > 0 ? 4 : 0);
    const avgNotSatisfied = row.avg_not_satisfied || (row.not_satisfied > 0 ? 1.5 : 0);

    return {
      question_key: row.question_key,
      satisfied: row.satisfied,
      neutral: row.neutral,
      not_satisfied: row.not_satisfied,
      avg_satisfied: Math.round(avgSatisfied * 100) / 100,
      avg_neutral: 3,
      avg_not_satisfied: Math.round(avgNotSatisfied * 100) / 100,
      total,
      satisfied_percent: total > 0 ? Math.round((row.satisfied / total) * 100) : 0,
      neutral_percent: total > 0 ? Math.round((row.neutral / total) * 100) : 0,
      not_satisfied_percent: total > 0 ? Math.round((row.not_satisfied / total) * 100) : 0
    };
  }).filter((row) => row.total > 0);

  const starRatingBreakdown = generalRows
    .filter((row) => row.numeric_count > 0)
    .map((row) => ({
      question_key: row.question_key,
      average: Math.round(row.average * 100) / 100,
      total: row.numeric_count
    }));

  const yesNoBreakdown = generalRows
    .map((row) => {
      const total = row.yes_count + row.no_count;
      return {
        question_key: row.question_key,
        yes: row.yes_count,
        no: row.no_count,
        yes_percent: total > 0 ? Math.round((row.yes_count / total) * 100) : 0,
        no_percent: total > 0 ? Math.round((row.no_count / total) * 100) : 0,
        total
      };
    })
    .filter((row) => row.total > 0);

  const totalGeneral = generalSatisfied + generalNeutral + generalNotSatisfied;

  return {
    total_submissions: totalSubmissions,
    doctor_averages: doctorAverages,
    general_satisfaction: {
      satisfied: generalSatisfied,
      neutral: generalNeutral,
      not_satisfied: generalNotSatisfied,
      total: totalGeneral,
      satisfied_percent: totalGeneral > 0 ? Math.round((generalSatisfied / totalGeneral) * 100) : 0,
      neutral_percent: totalGeneral > 0 ? Math.round((generalNeutral / totalGeneral) * 100) : 0,
      not_satisfied_percent: totalGeneral > 0 ? Math.round((generalNotSatisfied / totalGeneral) * 100) : 0
    },
    question_breakdown: questionBreakdown,
    star_rating_breakdown: starRatingBreakdown,
    yesno_breakdown: yesNoBreakdown
  };
}

module.exports = {
  DEFAULT_EXPORT_LIMIT,
  DEFAULT_REPORT_LIMIT,
  MAX_REPORT_LIMIT,
  buildSubmissionFilter,
  getAnalyticsData,
  getDoctorMetrics,
  getReportData,
  getSubmissionCount,
  normalizePagination
};
