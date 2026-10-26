function parseCourses(input){
 const links=[];
 for(const value of String(input).split(/[\s,，;；]+/).filter(Boolean)){
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||!['www.uooc.net.cn','uooc.net.cn'].includes(url.hostname)||url.username||url.password||url.port)throw Error('请粘贴 UOOC 官方课程或学习页网址');
  const id=url.pathname.match(/^\/home\/course\/(\d+)\/?$/)?.[1]||url.pathname.match(/^\/home\/learn\/(?:new\/)?(\d+)\/?$/)?.[1]||(/^\/home\/learn\/index\/?$/.test(url.pathname)?url.hash.match(/^#\/(\d+)(?:\/|$)/)?.[1]:null);
  if(!id)throw Error('网址缺少课程编号；学习页请保留 # 后面的完整内容');
  links.push('http://www.uooc.net.cn/home/course/'+id);
 }
 return [...new Set(links)];
}
module.exports={parseCourses};
