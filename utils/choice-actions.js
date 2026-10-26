// Independently implemented after reviewing zcx28/szu-uooc's native answer validation.
function inspectQuestion(el){
 const nodes=[...el.querySelectorAll('.ti-a')];
 const options=nodes.map((node,index)=>{const input=node.querySelector('input[type=radio],input[type=checkbox]');return {index,letter:node.innerText.trim().match(/^([A-H])\s*[.．、]/)?.[1],text:node.innerText,value:input?.hasAttribute('value')?input.value:null,checked:!!input?.checked,type:input?.type,exists:!!input};});
 const win=el.ownerDocument.defaultView;let question=null;
 if(win.angular?.element){let scope=win.angular.element(el).scope?.();for(let i=0;scope&&i<10;i++,scope=scope.$parent){if(scope.question&&Array.isArray(scope.question.options)){question=scope.question;break;}}}
 const model=question?{keys:question.options.map((o,i)=>typeof o==='string'?String(i):o?.key==null?null:String(o.key)),answers:Array.isArray(question.student_answer)?question.student_answer.map(String):[],checked:!!question.checked}:null;
 return {options,model,angular:!!win.angular};
}
async function clickChoices(q,answers,log=()=>{}){
 const letters=answers.map(a=>String(a).trim().replace(/[.．、]$/,''));
 if(!letters.length||letters.some(a=>!/^([A-H])$/.test(a))||new Set(letters).size!==letters.length)throw Error('选项答案格式错误或重复');
 const before=await q.evaluate(inspectQuestion),options=before.options;
 if(!Array.isArray(options)||!options.length)throw Error('未读取到有效选项，停止填写');
 if(before.angular&&!before.model)throw Error('无法核对网站原生答案模型，停止填写');
 const selected=letters.map(letter=>{const matches=options.filter(o=>o.letter===letter);if(matches.length!==1)throw Error('选项编号缺失或重复：'+letter);return matches[0];});
 if(options.some(o=>!o.exists))throw Error('选项缺少原生选择控件');
 if(selected.length>1&&selected.some(o=>o.type!=='checkbox'))throw Error('单选题不能填写多个答案');
 const native=options.some(o=>o.value!==null);
 if(native&&(options.some(o=>o.value===null||o.value==='')||new Set(options.map(o=>o.value)).size!==options.length))throw Error('原生选项ID缺失或重复');
 if(before.model&&(!native||selected.some(o=>before.model.keys.filter(k=>k===o.value).length!==1)))throw Error('页面选项ID与原生模型不一致');
 const selectedIndexes=new Set(selected.map(o=>o.index));
 for(const option of options){
  const desired=selectedIndexes.has(option.index);
  if((desired&&!option.checked)||(!desired&&option.checked&&option.type==='checkbox'))await q.locator('.ti-a').nth(option.index).click();
 }
 const expectedKeys=selected.map(o=>o.value).sort();
 for(let retry=0;retry<12;retry++){
  const after=await q.evaluate(inspectQuestion);
  if(before.model&&JSON.stringify(before.model.keys)!==JSON.stringify(after.model?.keys))throw Error('原生选项模型发生变化，禁止提交');
  const signature=list=>JSON.stringify(list.map(({index,letter,text,value,type})=>({index,letter,text,value,type})));
  if(signature(options)!==signature(after.options))throw Error('填写期间题目选项发生变化，禁止提交');
  const actual=after.options.filter(o=>o.checked).map(o=>o.index).sort((a,b)=>a-b),wanted=[...selectedIndexes].sort((a,b)=>a-b);
  const dom=JSON.stringify(actual)===JSON.stringify(wanted);
  const model=!before.model||(after.model?.checked&&JSON.stringify([...after.model.answers].sort())===JSON.stringify(expectedKeys));
  if(dom&&model){log('      ✅ 已核对选择 '+letters.join(',')+(before.model?'（原生答案已同步）':'（控件选中状态）'));return;}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error('选中状态或网站原生答案尚未同步，禁止提交');
}
async function verifyChoices(q,answers){
 const state=await q.evaluate(inspectQuestion),letters=answers.map(a=>String(a).trim().replace(/[.．、]$/,''));
 if(!Array.isArray(state.options)||!letters.length||new Set(letters).size!==letters.length)throw Error('待提交答案格式不完整');
 const expected=letters.map(letter=>{const matches=state.options.filter(o=>o.letter===letter);if(matches.length!==1)throw Error('待提交选项无法唯一定位');return matches[0];});
 const checked=state.options.filter(o=>o.checked).map(o=>o.index).sort((a,b)=>a-b);
 if(JSON.stringify(checked)!==JSON.stringify(expected.map(o=>o.index).sort((a,b)=>a-b)))throw Error('选中答案已发生变化');
 if(state.angular&&!state.model)throw Error('无法读取原生答案模型');
 if(state.model&&(!state.model.checked||JSON.stringify([...state.model.answers].sort())!==JSON.stringify(expected.map(o=>o.value).sort())))throw Error('原生答案模型与待提交答案不一致');
}
module.exports={clickChoices,verifyChoices};
