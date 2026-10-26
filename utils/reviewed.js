const fs = require('fs');
const normalize = text => String(text).replace(/\s+/g, '');

function reviewedAnswer(courseId, examIds, questionIndex, text, blankCount) {
    const file = process.env.UOOC_REVIEW_FILE;
    if (!file) return null;
    const entries = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(entries)) throw new Error('复核文件必须为数组');
    const candidates = entries.filter(entry => entry.courseId === String(courseId)
        && examIds.includes(String(entry.examId)));
    const matches = candidates.filter(entry => Array.isArray(entry.expectedFragments)
        && entry.expectedFragments.length && entry.expectedFragments.every(fragment => normalize(text).includes(normalize(fragment)))
        && (entry.blankCount === undefined || entry.blankCount === blankCount));
    if (matches.length > 1) throw new Error('复核记录匹配不唯一');
    const match = matches[0];
    if (!match) return null;
    if (!Array.isArray(match.expectedFragments) || !match.expectedFragments.length
        || !match.expectedFragments.every(fragment => normalize(text).includes(normalize(fragment)))
        || !Array.isArray(match.answers) || !match.answers.length || !match.evidence) {
        throw new Error('复核记录与当前题目不匹配或缺少证据');
    }
    return { answers: match.answers, answerTexts: match.answerTexts, evidence: match.evidence };
}

function resolveChoiceAnswers(answerTexts, choices) {
    return answerTexts.map(answer => {
        const matches = choices.map(text => String(text).trim().match(/^([A-H])[.、．]\s*([\s\S]*)$/))
            .filter(match => match && normalize(match[2]) === normalize(answer));
        if (matches.length !== 1) throw new Error('已核验选项内容未唯一匹配，拒绝使用旧字母答案');
        return matches[0][1];
    });
}

module.exports = { reviewedAnswer, resolveChoiceAnswers };
