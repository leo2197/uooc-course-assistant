const fs=require('node:fs'),path=require('node:path');
function classify(text){
 if(/课程已结束|课程已关闭|课程已过期|学习时间已结束|已结课/.test(text))return {status:'closed',reason:'平台显示课程已结束'};
 const rows=[];
 const pattern=/(?:^|\n)\s*(视频|测验|作业|考试)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)(?=\s|$)/g;
 for(const match of text.matchAll(pattern))rows.push({type:match[1],weight:Number(match[2]),total:Number(match[3]),done:Number(match[4])});
 if(!['视频','测验'].every(type=>rows.some(r=>r.type===type))||rows.some(r=>r.done>r.total)||new Set(rows.map(r=>r.type)).size!==rows.length)return {status:'unknown',reason:'任务表缺失或数值不一致，未自动开始',rows};
 const pending=rows.filter(r=>r.done<r.total),unpublished=rows.filter(r=>r.total===0&&r.weight>0).map(r=>r.type);
 if(pending.some(r=>['视频','测验'].includes(r.type)))return {status:'pending',reason:pending.map(r=>`${r.type}${r.done}/${r.total}`).join('，'),rows,unpublished};
 if(pending.length)return {status:'manual',reason:'视频和测验已完成，其余任务需人工处理：'+pending.map(r=>r.type).join('、'),rows,unpublished};
 if(!rows.some(r=>r.total>0))return {status:'not_published',reason:'尚未读取到已发布任务',rows,unpublished};
 return {status:'available_complete',reason:'当前已发布的视频和测验已完成'+(unpublished.length?'；尚未发布：'+unpublished.join('、'):''),rows,unpublished};
}
async function selectUnfinished(context,links,directory,log=console.log){
 fs.mkdirSync(directory,{recursive:true});const results=[],selected=[],seen=new Set();
 for(const url of links){
  const id=url.match(/^https?:\/\/www\.uooc\.net\.cn\/home\/course\/(\d+)\/?$/)?.[1];if(!id||seen.has(id))continue;seen.add(id);
  const page=await context.newPage();let result;
  try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000});await page.waitForTimeout(3000);let text=await page.locator('body').innerText();result=classify(text);
   for(let i=0;i<3&&result.status==='unknown';i++){await page.waitForTimeout(2000);text=await page.locator('body').innerText();result=classify(text);}
   fs.writeFileSync(path.join(directory,`course-${id}.txt`),text,'utf8');
  }catch(error){result={status:'unknown',reason:'课程状态读取失败：'+error.message.split('\n')[0]};}finally{await page.close();}
  results.push({courseId:id,url,...result});if(result.status==='pending')selected.push(url);log(`${result.status==='pending'?'▶ 选择':'⏭ 跳过'}课程 ${id}：${result.reason}`);
 }
 fs.writeFileSync(path.join(directory,'selection.json'),JSON.stringify({checkedAt:new Date().toISOString(),results,selected},null,2));return {selected,results};
}
module.exports={classify,selectUnfinished};
