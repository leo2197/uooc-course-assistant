const {locateInAnyFrame}=require('./utils/browser');
async function loggedIn(page){const avatar=page.locator('a.layout-header-avatar, #top_avatar');for(let i=0;i<await avatar.count();i++)if(await avatar.nth(i).isVisible())return true;return false;}
async function login(page,{username='',password='',log=console.log}={}){
 await page.goto('https://www.uooc.net.cn/',{waitUntil:'domcontentloaded',timeout:45000});
 if(await loggedIn(page)){log('已复用本机登录状态。');return;}
 const button=page.locator('#loginBtn');if(await button.isVisible().catch(()=>false))await button.click();
 log('\x07首次使用请在网页本人登录并完成安全验证。登录状态会留在此账号专用浏览器资料中；以后优先复用，失效时提示重新登录。');
 let filled=false;
 while(!page.isClosed()){
  if(await loggedIn(page)){log('网页登录已完成，继续识别课程。');return;}
  if(!filled&&username&&password){const account=await locateInAnyFrame(page,'#account1'),secret=await locateInAnyFrame(page,'#password');if(account&&secret){await account.fill(username);await secret.fill(password);filled=true;log('已填写原配置的账号信息，请在网页完成验证并登录。');}}
  await page.waitForTimeout(1000);
 }
 throw Error('浏览器已关闭，登录未完成');
}
module.exports={loggedIn,login};
