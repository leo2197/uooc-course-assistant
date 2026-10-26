const pid=Number(process.argv[2]);
if(!Number.isInteger(pid)||pid<=0) throw Error('Usage: node watch-grades.js <learningPID>');
process.env.UOOC_GRADE_WATCH_PID=String(pid);
delete process.env.UOOC_AUDIT;
delete process.env.UOOC_EXAM_ONLY;
delete process.env.UOOC_VIDEO_ONLY;
require('./start');
