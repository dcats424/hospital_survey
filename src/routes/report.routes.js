const path = require('path');
const { emailLimiter } = require('../middleware/rateLimiter');
const { requireAuth, requireModule } = require('../middleware/auth');
const { csvEscape } = require('../utils/helpers');
const { sendEmail } = require('../services/email');
const {
  DEFAULT_EXPORT_LIMIT,
  getDoctorMetrics,
  getReportData,
  normalizePagination
} = require('../services/reportMetrics');

const PDFDocument = require('pdfkit');

const MAX_EMAIL_BATCH = Number(process.env.REPORT_EMAIL_BATCH_LIMIT || 100);
const EMAIL_CONCURRENCY = Number(process.env.REPORT_EMAIL_CONCURRENCY || 3);

function textOrEmpty(value) {
  return (value && String(value).trim()) || '';
}

function getRatingStatus(rating) {
  if (rating >= 4.5) return 'Excellent';
  if (rating >= 4.0) return 'Very Good';
  if (rating >= 3.5) return 'Good';
  if (rating >= 3.0) return 'Average';
  if (rating >= 2.0) return 'Below Average';
  return 'Poor';
}

function formatDate(dateStr) {
  if (!dateStr) return 'All Time';
  const [y, m, d] = String(dateStr).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(dateStr);
}

function getFeedbackMessage(rating, questionRatings) {
  const strengths = [];
  const improvements = [];

  if (Array.isArray(questionRatings)) {
    for (const qr of questionRatings) {
      const avg = Number(qr.average) || 0;
      const questionName = qr.question_key || 'Rating';

      if (qr.type === 'yes_no') {
        const yesCount = Number(qr.yes_count) || 0;
        const noCount = Number(qr.no_count) || 0;
        const yesPct = (yesCount + noCount) > 0 ? Math.round((yesCount / (yesCount + noCount)) * 100) : 0;
        if (yesPct >= 80) strengths.push(questionName);
        else if (yesPct < 50) improvements.push(questionName);
      } else if (avg >= 4.0) {
        strengths.push(questionName);
      } else if (avg < 3.0) {
        improvements.push(questionName);
      }
    }
  }

  if (rating >= 4.0) {
    return 'Your overall performance is rated as Excellent. Patients consistently rate you at the highest levels across all aspects of care. Your dedication to patient satisfaction is evident. Continue providing this exceptional level of care.';
  }
  if (rating >= 3.5 && improvements.length > 0) {
    return `Your overall performance is rated as Good. Patients appreciate your care and service.\n\nAreas where you excel: ${strengths.join(', ')}.\n\nAreas for improvement: ${improvements.join(', ')}. Focusing on these areas could help enhance overall patient satisfaction even more.`;
  }
  if (rating >= 3.5) {
    return 'Your overall performance is rated as Good. Patients appreciate the care and service you provide. Your professionalism and communication were positively recognized.\n\nThere are opportunities for further improvement in areas such as quality of care experience and time & attention, which could help enhance overall patient satisfaction even more.';
  }
  if (rating >= 3.0) {
    return `Your overall performance is rated as Average. ${improvements.length > 0 ? `Specific areas needing attention: ${improvements.join(', ')}.` : 'Consider reviewing the detailed feedback to identify specific areas where you can enhance patient experience.'}`;
  }
  return `Your overall performance needs improvement. We recommend focusing on: ${improvements.length > 0 ? improvements.join(', ') : 'all aspects of patient care'}. Please review the detailed feedback carefully and work with your supervisors to develop an improvement plan.`;
}

function buildDoctorEmail({ doctorName, rating, total, dateFrom, dateTo, questionRatings }) {
  let categoryRatingsText = '';
  if (Array.isArray(questionRatings) && questionRatings.length > 0) {
    categoryRatingsText = questionRatings.map((qr) => {
      const questionName = qr.question_key || 'Rating';
      if (qr.type === 'yes_no') {
        const yesCount = Number(qr.yes_count) || 0;
        const noCount = Number(qr.no_count) || 0;
        const yesPct = (yesCount + noCount) > 0 ? Math.round((yesCount / (yesCount + noCount)) * 100) : 0;
        return `* ${questionName}: ${yesPct}% Positive Response (${yesCount} Yes / ${noCount} No)`;
      }
      return `* ${questionName}: ${(Number(qr.average) || 0).toFixed(1)} / 5.0`;
    }).join('\n');
  }

  const message = `Dear ${doctorName},

Please find below your Patient Feedback Performance Report for the evaluation period ${formatDate(dateFrom)} - ${formatDate(dateTo)}.

This report is based on feedback received from ${total} patient${total !== 1 ? 's' : ''} who completed the patient satisfaction survey during their visit.

Overall Performance Rating

${rating.toFixed(1)} / 5.0
Performance Level: ${getRatingStatus(rating)}

Category Ratings

${categoryRatingsText}

Performance Summary

${getFeedbackMessage(rating, questionRatings)}

We appreciate your continued commitment to delivering quality healthcare services and value your dedication to patient care.

Kind regards,
Management Team`;

  return `<pre style="font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;">${message}</pre>`;
}

function getDoctorColumnValue(doctor, questionKey) {
  const qr = doctor.question_ratings?.find((q) => q.question_key === questionKey);
  if (!qr) return '-';
  if (qr.type === 'yes_no') return `Yes: ${qr.yes_count}, No: ${qr.no_count}`;
  return qr.average ? qr.average.toFixed(1) : '-';
}

function getQuestionKeys(rows) {
  const seen = new Set();
  const keys = [];
  for (const row of rows || []) {
    for (const qr of row.question_ratings || []) {
      if (!seen.has(qr.question_key)) {
        seen.add(qr.question_key);
        keys.push(qr.question_key);
      }
    }
  }
  return keys;
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sendCsv(res, reportType, reportData) {
  const ratings = reportData.doctors || [];
  const generalSurvey = reportData.general_survey || [];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${reportType}_report.csv"`);

  if (reportType === 'doctor') {
    const doctorQuestionKeys = getQuestionKeys(ratings);
    res.write('Doctor Name,Patients,' + doctorQuestionKeys.join(',') + ',Average Rating\n');
    for (const doctor of ratings) {
      const row = [
        doctor.doctor_name,
        doctor.patient_count,
        ...doctorQuestionKeys.map((key) => getDoctorColumnValue(doctor, key)),
        doctor.average_rating ? doctor.average_rating.toFixed(2) : '0.00'
      ];
      res.write(row.map(csvEscape).join(',') + '\n');
    }
  } else {
    const generalQuestionKeys = generalSurvey.map((item) => item.question_key);
    const numericAverages = generalSurvey.filter((item) => item.type !== 'yes_no' && item.average).map((item) => item.average);
    const overallAvg = numericAverages.length > 0 ? (numericAverages.reduce((a, b) => a + b, 0) / numericAverages.length).toFixed(1) : '-';

    res.write('Total Submissions,' + generalQuestionKeys.join(',') + ',Average\n');
    const row = [reportData.total_submissions];
    for (const key of generalQuestionKeys) {
      const item = generalSurvey.find((question) => question.question_key === key);
      row.push(item ? (item.type === 'yes_no' ? `Yes: ${item.yes_count}, No: ${item.no_count}` : (item.average || '-')) : '-');
    }
    res.write(row.map(csvEscape).join(',') + ',' + csvEscape(overallAvg) + '\n');
  }

  res.end();
}

function sendXlsx(res, reportType, reportData) {
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  const ratings = reportData.doctors || [];
  const generalSurvey = reportData.general_survey || [];

  if (reportType === 'doctor') {
    const doctorQuestionKeys = getQuestionKeys(ratings);
    const rows = ratings.map((doctor) => {
      const row = {
        'Doctor Name': doctor.doctor_name,
        Patients: doctor.patient_count
      };
      for (const key of doctorQuestionKeys) row[key] = getDoctorColumnValue(doctor, key);
      row['Average Rating'] = doctor.average_rating ? doctor.average_rating.toFixed(2) : '0.00';
      return row;
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Doctor Report');
  } else {
    const generalQuestionKeys = generalSurvey.map((item) => item.question_key);
    const numericAverages = generalSurvey.filter((item) => item.type !== 'yes_no' && item.average).map((item) => item.average);
    const overallAvg = numericAverages.length > 0 ? (numericAverages.reduce((a, b) => a + b, 0) / numericAverages.length).toFixed(1) : '-';
    const row = { 'Total Submissions': reportData.total_submissions };
    for (const key of generalQuestionKeys) {
      const item = generalSurvey.find((question) => question.question_key === key);
      row[key] = item ? (item.type === 'yes_no' ? `Yes: ${item.yes_count}, No: ${item.no_count}` : (item.average || '-')) : '-';
    }
    row.Average = overallAvg;
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([row]), 'General Report');
  }

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${reportType}_report.xlsx"`);
  return res.send(buffer);
}

function sendPdf(res, reportType, reportData, dateFrom, dateTo) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${reportType}_report.pdf"`);
  doc.pipe(res);

  try {
    doc.image(path.join(__dirname, '../../frontend/image/girum-logo.png'), 40, 12, { width: 40, height: 40 });
  } catch (e) {}

  doc.fillColor('#111827').fontSize(18).font('Helvetica-Bold').text('Girum Hospital', 0, 18, { align: 'center', width: 595 });
  doc.fontSize(12).font('Helvetica').text(reportType === 'doctor' ? 'Doctor Report' : 'General Report', 0, 42, { align: 'center', width: 595 });
  if (dateFrom || dateTo) {
    doc.fontSize(9).fillColor('#111827').text(`Period: ${dateFrom || 'Start'} - ${dateTo || 'Now'}`, 40, 65);
  }

  let y = 95;
  if (reportType === 'doctor') {
    const headers = ['No', 'Doctor', 'Patients', 'Average'];
    const widths = [35, 260, 80, 100];
    doc.fontSize(8).font('Helvetica-Bold');
    headers.forEach((header, index) => doc.text(header, 40 + widths.slice(0, index).reduce((a, b) => a + b, 0), y, { width: widths[index] }));
    y += 18;
    doc.font('Helvetica');

    (reportData.doctors || []).forEach((doctor, index) => {
      if (y > 760) {
        doc.addPage();
        y = 40;
      }
      const values = [
        String(index + 1),
        doctor.doctor_name,
        String(doctor.patient_count),
        doctor.average_rating ? doctor.average_rating.toFixed(2) : '0.00'
      ];
      values.forEach((value, column) => doc.text(value, 40 + widths.slice(0, column).reduce((a, b) => a + b, 0), y, { width: widths[column] }));
      y += 18;
    });
  } else {
    doc.fontSize(10).font('Helvetica-Bold').text('Total Submissions', 40, y);
    doc.font('Helvetica').text(String(reportData.total_submissions || 0), 200, y);
    y += 24;
    for (const item of reportData.general_survey || []) {
      if (y > 760) {
        doc.addPage();
        y = 40;
      }
      const value = item.type === 'yes_no'
        ? `Yes: ${item.yes_count}, No: ${item.no_count}`
        : String(item.average || '-');
      doc.font('Helvetica-Bold').text(item.question_key, 40, y, { width: 220 });
      doc.font('Helvetica').text(value, 280, y, { width: 220 });
      y += 18;
    }
  }

  doc.end();
}

function register(app) {
  app.get('/api/doctor-ratings', requireAuth, requireModule('doctor-ratings'), async function (req, res) {
    try {
      const result = await getDoctorMetrics({
        dateFrom: textOrEmpty(req.query.date_from),
        dateTo: textOrEmpty(req.query.date_to),
        doctorName: textOrEmpty(req.query.doctor_name),
        includeEmails: true
      });
      return res.json({ ratings: result.ratings, total: result.total });
    } catch (e) {
      return res.status(500).json({ error: 'fetch_failed' });
    }
  });

  app.get('/api/report', requireAuth, requireModule('reports'), async function (req, res) {
    try {
      const pagination = normalizePagination(req.query.page, req.query.limit);
      const reportData = await getReportData({
        dateFrom: textOrEmpty(req.query.date_from),
        dateTo: textOrEmpty(req.query.date_to),
        doctorName: textOrEmpty(req.query.doctor_name),
        page: pagination.page,
        limit: pagination.limit
      });

      return res.json({
        ...reportData,
        date_from: textOrEmpty(req.query.date_from),
        date_to: textOrEmpty(req.query.date_to)
      });
    } catch (e) {
      return res.status(500).json({ error: 'fetch_failed' });
    }
  });

  app.get('/api/report/export', requireAuth, requireModule('reports'), async function (req, res) {
    try {
      const format = String(req.query.format || 'csv').toLowerCase();
      const reportType = String(req.query.report_type || 'doctor').toLowerCase() === 'doctor' ? 'doctor' : 'general';
      const exportLimit = Math.min(DEFAULT_EXPORT_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_EXPORT_LIMIT));
      const dateFrom = textOrEmpty(req.query.date_from);
      const dateTo = textOrEmpty(req.query.date_to);

      const reportData = await getReportData({
        dateFrom,
        dateTo,
        doctorName: textOrEmpty(req.query.doctor_name),
        page: 1,
        limit: exportLimit
      });

      if (reportData.doctors_total > exportLimit) {
        return res.status(413).json({
          error: 'export_too_large',
          message: `Export matched ${reportData.doctors_total} doctors. Narrow the date/name filter or raise the export limit.`
        });
      }

      if (format === 'csv') return sendCsv(res, reportType, reportData);
      if (format === 'xlsx') return sendXlsx(res, reportType, reportData);
      if (format === 'pdf') return sendPdf(res, reportType, reportData, dateFrom, dateTo);

      return res.status(400).json({ error: 'invalid_format', details: 'Supported formats: csv, xlsx, pdf' });
    } catch (e) {
      return res.status(500).json({ error: 'export_failed' });
    }
  });

  app.post('/api/doctor-ratings/send-email', requireAuth, requireModule('doctor-ratings'), emailLimiter, async function (req, res) {
    try {
      const email = textOrEmpty(req.body.email);
      if (!email) return res.status(400).json({ error: 'email_required' });

      const doctorName = textOrEmpty(req.body.doctor_name);
      const rating = Number(req.body.average_rating) || 0;
      const total = Number(req.body.total_patients || req.body.total_ratings || 0);
      const html = buildDoctorEmail({
        doctorName,
        rating,
        total,
        dateFrom: req.body.date_from,
        dateTo: req.body.date_to,
        questionRatings: req.body.question_ratings
      });

      const result = await sendEmail({
        to: email,
        subject: `Patient Feedback Report - ${doctorName} | Rating: ${rating.toFixed(1)}/5`,
        html
      });

      if (!result.ok) return res.status(500).json({ error: 'email_failed', details: result.error });
      return res.json({ ok: true, message: 'Email sent successfully' });
    } catch (e) {
      return res.status(500).json({ error: 'send_failed' });
    }
  });

  app.post('/api/doctor-ratings/send-all', requireAuth, requireModule('doctor-ratings'), emailLimiter, async function (req, res) {
    try {
      const ratings = Array.isArray(req.body.ratings) ? req.body.ratings.filter((rating) => rating && rating.email) : [];
      if (ratings.length === 0) return res.status(400).json({ error: 'ratings_required' });
      if (ratings.length > MAX_EMAIL_BATCH) {
        return res.status(413).json({ error: 'email_batch_too_large', max: MAX_EMAIL_BATCH });
      }

      const results = { sent: [], failed: [] };
      await runWithConcurrency(ratings, EMAIL_CONCURRENCY, async (doctor) => {
        const doctorName = textOrEmpty(doctor.doctor_name);
        const rating = Number(doctor.average_rating) || 0;
        const total = Number(doctor.total_patients || doctor.patient_count || 0);
        const html = buildDoctorEmail({
          doctorName,
          rating,
          total,
          dateFrom: req.body.date_from,
          dateTo: req.body.date_to,
          questionRatings: doctor.question_ratings
        });

        try {
          const result = await sendEmail({
            to: doctor.email,
            subject: `Patient Feedback Report - ${doctorName} | Rating: ${rating.toFixed(1)}/5`,
            html
          });
          if (result.ok) results.sent.push({ doctor_id: doctor.doctor_id, doctor_name: doctorName, email: doctor.email });
          else results.failed.push({ doctor_id: doctor.doctor_id, doctor_name: doctorName, email: doctor.email, error: result.error });
        } catch (err) {
          results.failed.push({ doctor_id: doctor.doctor_id, doctor_name: doctorName, email: doctor.email, error: err.message });
        }
      });

      return res.json({
        ok: true,
        message: `Sent ${results.sent.length} emails, ${results.failed.length} failed`,
        results
      });
    } catch (e) {
      return res.status(500).json({ error: 'send_all_failed' });
    }
  });
}

module.exports = { register };
