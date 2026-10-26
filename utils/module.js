const fs = require('fs');
const path = require('path');
const {
    API_KEY, MODEL_NAME, API_BASE_URL,
    ENSEMBLE_MODELS, ENSEMBLE_MIN_AGREE, JUDGE_MODEL, ENSEMBLE_TIMEOUT
} = require('./config');
const budget = require('./budget');

const QUIZ_PROMPT = '请仔细阅读图片中的题干和所有选项，分析并找出正确答案。如果选项前面是方框，就是多选题，圆框就是单选题。做题之前，你需要先判断这个题是单选题还是多选题。只要求返回一个 JSON 对象。如果这道题只需要一个答案或者只有一个正确答案，请放在数组 answers 里面。只返回一个 JSON，不要输出任何解释或者 markdown 代码块包裹。\n例如：{"answers":["A","C"]}。如果你无论如何都无法确定并且真的找不到，才返回 {"answers":[]}';

// 填空题 / 程序填空题的提示词：答案是文字，不是选项字母
const BLANK_PROMPT = '请仔细阅读图片中的题目。这是一道填空题（或程序填空题），不是选择题，没有选项可点。请直接给出应该填写的内容，并原样输出（保留字母大小写、空格和符号；不要加引号、不要解释、不要 markdown 代码块包裹）。只返回一个 JSON 对象；如果有多个空，按顺序放进数组。例如：{"answers":["printf"]} 或 {"answers":["int a=1;","printf"]}。如果确实无法确定，才返回 {"answers":[]}。';

// 是不是"答案要打字"的题型
const isBlankType = t => /填空|简答|论述|程序/.test(String(t || ''));

// 把 ["b","a"] / ["B."] 这类答案归一化成可比较的签名
function normalizeAnswers(arr, isBlank) {
    if (!Array.isArray(arr)) return [];
    if (isBlank) {
        // 填空题：答案要打进输入框 → 保留大小写/空格/符号，也不能排序（多个空有先后顺序）
        return arr
            .map(a => String(a == null ? '' : a).replace(/\s+/g, ' ').trim())
            .filter(Boolean);
    }
    const clean = arr
        .map(a => String(a).trim().replace(/[\.\s○]/g, '').toUpperCase())
        .filter(a => /^[A-H]$/.test(a));
    return [...new Set(clean)].sort();
}

function signatureOf(answers) {
    return answers.join(',');
}

// 单模型请求：返回 { model, answers, ms, error }
// 魔搭偶发返回 choices:null 的空壳响应，这里自动重试最多 2 次
async function askModel({ model, imageBase64, questionType, reasoningEffort = 'medium', log, timeout = ENSEMBLE_TIMEOUT, attempts = 2, context = '', questionText = '', decisionRequired = false }) {
    const _log = log || console.log;
    const isBlank = isBlankType(questionType);
    const glm53 = /^glm-5\.3(?:-|$)/i.test(model);
    const body = {
        model,
        temperature: glm53 ? 1 : 0,
        top_p: glm53 ? 0.95 : 1,
        reasoning_effort: glm53 && reasoningEffort === 'medium' ? 'high' : reasoningEffort,
        ...(glm53 ? { thinking: { type: 'enabled' } } : {}),
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: (isBlank ? BLANK_PROMPT : QUIZ_PROMPT) + (questionType ? `\n\n题型提示：${questionType}` : '')
                    + (questionText ? '\n\n【页面提取的原始题干和当前选项】\n' + questionText + '\n请按原文逐字符分析，图片用于补充原文缺失的公式和图示。不要把前置++读成后置++，不要忽略数值前导0、%%、整除、类型转换和参数顺序。答案字母必须对应本次原文中的选项。' : '')
                    + (context ? ('\n\n【课程视频文稿摘录（可能相关、也可能无关）】\n如果题目问的是视频里讲过的具体内容（人物、数字、情节、案例），优先依据下面的片段作答；\n如果这些片段跟题目对不上，就当没看见，按你自己的知识正常作答，别被它们带偏：\n' + context) : '')
                    + (decisionRequired ? '\n\n【最终裁决】必须返回JSON：{"answers":["B"],"decision":"submit","reason":"简短核验依据"}。只有你能确定题意与答案时才用submit；无法看清、题目有歧义或仍不确定时用decision:"review"，reason说明需核对之处。不确定时不得为了自动运行而猜测。' : '') },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
            ]
        }]
    };

    const t0 = Date.now();
    let lastError = '未取得答案';

    for (let attempt = 1; attempt <= attempts; attempt++) {
        // 额度闸门：今日额度用完就直接不发请求，避免烧光魔搭免费额度
        if (!budget.consume()) {
            _log(`🛑 今日 API 额度已用完（${budget.summary()}），本模型不再调用`);
            return { model, answers: [], ms: Date.now() - t0, error: '今日额度已用完' };
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const resp = await fetch(API_BASE_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            if (!resp.ok) {
                const txt = await resp.text().catch(() => '');
                lastError = `HTTP ${resp.status} ${txt.slice(0, 100)}`;
            } else {
                const data = await resp.json();
                const choice = data.choices?.[0];
                const content = choice?.message?.content;

                if (!content) {
                    lastError = data.choices === null ? '空壳响应(choices:null)' : '响应无内容';
                } else {
                    let jsonText = typeof content === 'string'
                        ? content
                        : (content.find(p => p.type === 'text') || content[0])?.text ?? '';
                    jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
                    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) jsonText = jsonMatch[0];
                    try {
                        const parsed = JSON.parse(jsonText);
                        const answers = normalizeAnswers(parsed.answers, isBlank);
                        if (answers.length > 0) {
                            return { model, answers, ms: Date.now() - t0, attempts: attempt,
                                needsReview: decisionRequired && (parsed.decision !== 'submit' || typeof parsed.reason !== 'string' || !parsed.reason.trim()),
                                reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
                        }
                        lastError = '模型返回空答案数组';
                    } catch {
                        lastError = `解析失败: ${jsonText.slice(0, 80)}`;
                    }
                }
            }
        } catch (err) {
            lastError = err.name === 'AbortError' ? `超时(${Math.round(timeout / 1000)}s)`
                : err.message + (err.cause?.code ? ` (${err.cause.code})` : '');
        } finally {
            clearTimeout(timeoutId);
        }

        // 失败后短暂等待再重试（避开偶发限流）
        if (attempt < attempts) {
            _log(`      ↻ ${model.split('/').pop()} 第 ${attempt} 次无结果(${lastError})，重试...`);
            await new Promise(r => setTimeout(r, 1200));
        }
    }

    return { model, answers: [], ms: Date.now() - t0, error: lastError };
}

// 单模型识别（保留原接口）
async function getAnswersFromImage(imagePath, questionType = '选择题', log, options = {}) {
    const _log = log || console.log;
    const modelName = options.model || MODEL_NAME;
    const thinkingLevel = options.reasoningEffort || 'medium';
    const absPath = path.resolve(imagePath);

    let imageBase64;
    try {
        imageBase64 = fs.readFileSync(absPath).toString('base64');
    } catch (err) {
        _log('❌ 读取图片失败:', err.message);
        return [];
    }

    _log(`🤖 请求大模型识别 (${modelName}, thinking: ${thinkingLevel})...`);
    const r = await askModel({ model: modelName, imageBase64, questionType, reasoningEffort: thinkingLevel, log: _log,
        context: options.context || '', questionText: options.questionText || '' });
    if (r.error) {
        _log(`❌ ${modelName} 失败: ${r.error}`);
        return [];
    }
    _log(`✅ ${modelName} 答案: ${signatureOf(r.answers) || '(空)'} (${(r.ms / 1000).toFixed(1)}s)`);
    return r.answers;
}

/**
 * 多模型并行投票
 * options: { models: string[], reasoningEffort, minAgree, useJudge, judgeModel }
 * 返回 { answers, agreement, total, confident, detail: [{model, answers, ms, error}] }
 */
async function getEnsembleAnswers(imagePath, questionType = '选择题', log, options = {}) {
    const _log = log || console.log;
    const models = (options.models && options.models.length > 0) ? options.models : ENSEMBLE_MODELS;
    const effort = options.reasoningEffort || 'medium';
    const minAgree = options.minAgree || ENSEMBLE_MIN_AGREE;
    const useJudge = options.useJudge !== false;

    const absPath = path.resolve(imagePath);
    let imageBase64;
    try {
        imageBase64 = fs.readFileSync(absPath).toString('base64');
    } catch (err) {
        _log('❌ 读取图片失败:', err.message);
        return { answers: [], agreement: 0, total: models.length, confident: false, detail: [] };
    }

    _log(`🗳️ 并行调用 ${models.length} 个模型投票 (thinking: ${effort})...`);

    // 并行请求，谁先回来先记；一旦多数票已不可能被翻盘就提前收工
    const results = new Array(models.length);

    const tallyNow = () => {
        const map = new Map();
        for (const r of results) {
            if (!r || r.error || r.answers.length === 0) continue;
            const sig = signatureOf(r.answers);
            if (!map.has(sig)) map.set(sig, { answers: r.answers, models: [] });
            map.get(sig).models.push(r.model.split('/').pop());
        }
        const ranked = [...map.values()].sort((a, b) => b.models.length - a.models.length);
        return { map, ranked, top: ranked[0] || null };
    };

    await Promise.all(models.map(async (m, i) => {
        results[i] = await askModel({ model: m, imageBase64, questionType, reasoningEffort: effort, log: _log,
            context: options.context || '', questionText: options.questionText || '', decisionRequired: !!options.decisionRequired });
    }));

    // 输出每个模型的结果
    for (const r of results) {
        if (!r) continue;
        const shortName = r.model.split('/').pop();
        if (r.error || r.answers.length === 0) {
            _log(`   ⚠️ ${shortName}: ${r.error || '返回空答案'} (${(r.ms / 1000).toFixed(1)}s)`);
        } else {
            _log(`   🔹 ${shortName}: ${signatureOf(r.answers)} (${(r.ms / 1000).toFixed(1)}s)`);
        }
    }

    const total = models.length;
    const { ranked, top } = tallyNow();
    if (!top) {
        _log('❌ 所有模型均未给出答案');
        return { answers: [], agreement: 0, total, confident: false, detail: results };
    }

    const needAgree = Math.min(minAgree, models.length);
    if (top.models.length >= needAgree) {
        _log(`✅ 投票一致 (${top.models.length}/${total}): ${signatureOf(top.answers)} ← ${top.models.join(' / ')}`);
        _log(`   📊 ${budget.summary()}`);
        return {
            answers: top.answers,
            agreement: top.models.length,
            total,
            confident: top.models.length === total && !results.some(r => r?.needsReview),
            detail: results
        };
    }

    // 分歧：让裁决模型用高推理强度再判一次
    _log(`⚠️ 模型意见分歧 (最高仅 ${top.models.length}/${total} 票): ${ranked.map(r => `${signatureOf(r.answers)}×${r.models.length}`).join('  ')}`);

    if (!useJudge) {
        _log(`⚠️ 未启用裁决，采用最高票答案: ${signatureOf(top.answers)}`);
        return { answers: top.answers, agreement: top.models.length, total, confident: false, detail: results };
    }

    const judgeModel = options.judgeModel || JUDGE_MODEL;
    _log(`⚖️ 交由裁决模型 ${judgeModel.split('/').pop()} 用高推理强度复核...`);
    const verdict = await askModel({
        model: judgeModel, imageBase64, questionType, reasoningEffort: 'high', log: _log,
        context: options.context || '', questionText: options.questionText || ''
    });

    if (verdict.error || verdict.answers.length === 0) {
        _log(`⚠️ 裁决失败(${verdict.error || '空答案'})，回退到最高票答案: ${signatureOf(top.answers)}`);
        return { answers: top.answers, agreement: top.models.length, total, confident: false, detail: results };
    }

    const vSig = signatureOf(verdict.answers);
    const matched = ranked.find(r => signatureOf(r.answers) === vSig);
    if (matched) {
        _log(`✅ 裁决结果 ${vSig} 与某候选一致 (${matched.models.length} 票)，采纳`);
    } else {
        _log(`✅ 采纳裁决答案: ${vSig}（${(verdict.ms / 1000).toFixed(1)}s）`);
    }
    return {
        answers: verdict.answers,
        agreement: matched ? matched.models.length : 1,
        total: total + 1,
        confident: false,
        judged: true,
        detail: results
    };
}

module.exports = { getAnswersFromImage, getEnsembleAnswers, normalizeAnswers, signatureOf, isBlankType };
