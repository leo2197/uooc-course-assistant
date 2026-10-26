const {pick}=require('./assistant.cjs');
async function select(context,links,{question,log=console.log}={}){
 const rows=[];
 for(const url of links){const page=await context.newPage();try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});const heading=page.locator('h1');const title=await heading.first().innerText({timeout:3000}).catch(()=>page.title());rows.push({url,title:String(title).trim()||url});}finally{await page.close();}}
 rows.forEach((row,i)=>log((i+1)+'. '+row.title));
 let rl;if(!question){rl=require('readline/promises').createInterface({input:process.stdin,output:process.stdout});question=text=>rl.question(text);}
 try{for(;;){const input=(await question('输入课程编号（多门用空格分隔；A全部，0返回）：')).trim();if(input==='0')return [];if(/^a$/i.test(input))return links;try{const indices=pick(input);if(indices.some(i=>i>rows.length))throw Error('编号超出课程列表');return indices.map(i=>rows[i-1].url);}catch(e){log(e.message);}}}finally{rl?.close();}
}
module.exports={select};
