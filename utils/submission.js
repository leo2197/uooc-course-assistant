const fs = require('fs');
const path = require('path');
function reserveSubmission(directory, courseId, examIds) {
    const exams = [...new Set(examIds)];
    if (!/^\d+$/.test(String(courseId)) || exams.length !== 1 || !/^\d+$/.test(exams[0])) {
        throw Error('无法唯一识别测验，拒绝提交');
    }
    const target = path.join(directory, 'submission-attempts');
    fs.mkdirSync(target, { recursive: true });
    const record = path.join(target, `${courseId}-${exams[0]}.json`);
    // Write before the first click: an ambiguous result must never authorize a retry.
    fs.writeFileSync(record, JSON.stringify({ courseId, examId: exams[0],
        reservedAt: new Date().toISOString(), status: 'attempt-reserved' }), { flag: 'wx' });
    return record;
}
module.exports = { reserveSubmission };
