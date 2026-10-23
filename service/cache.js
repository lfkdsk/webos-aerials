'use strict';
// Local cache of Aerial clips for the launcher screensaver. One download at a time,
// resumed with Range requests, written as <id>.<quality>.part and renamed when whole.
// No webOS dependency here so the logic can run under plain node for tests.
var fs=require('fs'),path=require('path'),crypto=require('crypto');

var ID=/^[0-9A-Fa-f-]{36}$/,QUALITY=/^[0-9A-Za-z-]{1,12}$/;
function fileName(id,quality){return id+'.'+quality+'.mov';}
function okEntry(e){return e&&ID.test(e.id)&&QUALITY.test(e.quality)&&typeof e.url==='string'&&/^https:\/\/sylvan\.apple\.com\//.test(e.url);}

// sylvan.apple.com chains to Apple's own root, which Node's bundled Mozilla store lacks,
// so the TV's node fails with UNABLE_TO_GET_ISSUER_CERT_LOCALLY. ca.pem (Apple Root CA
// plus the server-auth intermediate) is added to the trust list; nothing is skipped.
function trustedCAs(){
 try{
  var extra=fs.readFileSync(path.join(__dirname,'ca.pem'),'utf8').split(/(?=-----BEGIN CERTIFICATE-----)/).filter(function(s){return /BEGIN CERTIFICATE/.test(s);});
  return (require('tls').rootCertificates||[]).concat(extra);
 }catch(_){return undefined;}
}

function createCache(options){
 var dir=options.dir,https=options.https||require('https'),log=options.log||function(){},ca=options.ca===undefined?trustedCAs():options.ca;
 var wanted=[],current=null,listeners=[],stopped=false,lastError=null,timer=null;

 function ensureDir(){if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true,mode:493});}
 function listFiles(){
  var out={};
  try{fs.readdirSync(dir).forEach(function(f){
   var m=/^([0-9A-Fa-f-]{36})\.([0-9A-Za-z-]{1,12})\.mov(\.part)?$/.exec(f);if(!m)return;
   var st;try{st=fs.statSync(path.join(dir,f));}catch(_){return;}
   var key=m[1]+'.'+m[2];if(out[key]&&out[key].complete)return;
   out[key]={id:m[1],quality:m[2],size:st.size,complete:!m[3],path:path.join(dir,fileName(m[1],m[2]))};
  });}catch(_){}
  return Object.keys(out).map(function(k){return out[k];});
 }
 function free(){
  try{var s=fs.statfsSync?fs.statfsSync(dir):null;return s?s.bavail*s.bsize:null;}catch(_){return null;}
 }
 function status(){
  return {cacheDir:dir,files:listFiles(),wanted:wanted.length,
   downloading:current?{id:current.id,quality:current.quality,received:current.received,total:current.total}:null,
   free:free(),error:lastError};
 }
 function notify(){var s=status();listeners.slice().forEach(function(fn){try{fn(s);}catch(_){}});}

 function missing(){
  var have={};listFiles().forEach(function(f){if(f.complete)have[f.id+'.'+f.quality]=true;});
  return wanted.filter(function(w){return !have[w.id+'.'+w.quality];});
 }
 function prune(){
  var keep={};wanted.forEach(function(w){keep[w.id+'.'+w.quality]=true;});
  listFiles().forEach(function(f){
   if(keep[f.id+'.'+f.quality])return;
   if(current&&current.id===f.id&&current.quality===f.quality)return;
   [f.path,f.path+'.part'].forEach(function(p){try{fs.unlinkSync(p);}catch(_){}});
  });
 }

 function download(entry){
  return new Promise(function(resolve){
   var target=path.join(dir,fileName(entry.id,entry.quality)),part=target+'.part',received=0;
   try{received=fs.statSync(part).size;}catch(_){received=0;}
   current={id:entry.id,quality:entry.quality,received:received,total:null,req:null};
   var headers={'User-Agent':'CleanYourTV-Aerials/1.0'};if(received>0)headers.Range='bytes='+received+'-';
   var finished=false;
   function done(err){
    if(finished)return;finished=true;clearTimeout(timer);
    if(err){lastError=String(err.message||err);log('download failed',entry.id,lastError);}else lastError=null;
    var cancelled=!!(current&&current.cancelled);current=null;notify();resolve(err?(cancelled?'cancelled':false):true);
   }
   var req;
   var reqOptions={headers:headers};if(ca)reqOptions.ca=ca;
   try{req=https.get(entry.url,reqOptions,function(res){
    if(res.statusCode===416){try{fs.renameSync(part,target);}catch(_){}res.resume();done();return;}
    if(received>0&&res.statusCode===200){received=0;try{fs.unlinkSync(part);}catch(_){}}
    else if(res.statusCode!==200&&res.statusCode!==206){res.resume();done(new Error('http-'+res.statusCode));return;}
    var len=parseInt(res.headers['content-length'],10);current.total=isFinite(len)?received+len:null;notify();
    var out=fs.createWriteStream(part,{flags:received>0?'a':'w',mode:420});
    res.on('data',function(chunk){received+=chunk.length;current.received=received;});
    res.on('error',function(e){out.destroy();done(e);});
    out.on('error',function(e){res.destroy();done(e);});
    out.on('finish',function(){
     if(current&&current.total!==null&&received<current.total){done(new Error('short-read'));return;}
     try{fs.renameSync(part,target);}catch(e){done(e);return;}
     done();
    });
    res.pipe(out);
    timer=setInterval(notify,1000);
   });}catch(e){done(e);return;}
   current.req=req;
   req.on('error',done);
   req.setTimeout(30000,function(){req.destroy(new Error('timeout'));});
  });
 }

 var running=false;
 async function pump(){
  if(running)return;running=true;
  try{
   while(!stopped){
    var next=missing()[0];if(!next)break;
    var fr=free();if(fr!==null&&fr<1.5*1024*1024*1024){lastError='disk-full';break;}
    var ok=await download(next);
    if(ok==='cancelled')continue;
    if(!ok){await new Promise(function(r){setTimeout(r,15000);});if(stopped||missing()[0]===next)break;}
   }
  }finally{running=false;notify();}
 }

 return {
  status:status,
  // Replaces the target set. Files outside it are deleted; the first missing one starts downloading.
  sync:function(list){
   ensureDir();
   wanted=(Array.isArray(list)?list:[]).filter(okEntry).slice(0,60).map(function(e){return {id:e.id,quality:e.quality,url:e.url};});
   stopped=false;
   if(current&&!wanted.some(function(w){return w.id===current.id&&w.quality===current.quality;})&&current.req){current.cancelled=true;current.req.destroy(new Error('cancelled'));}
   prune();pump();
   return status();
  },
  clear:function(){
   stopped=true;wanted=[];
   if(current&&current.req){current.cancelled=true;current.req.destroy(new Error('cancelled'));}
   listFiles().forEach(function(f){[f.path,f.path+'.part'].forEach(function(p){try{fs.unlinkSync(p);}catch(_){}});});
   lastError=null;return status();
  },
  subscribe:function(fn){listeners.push(fn);return function(){var i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);};},
  busy:function(){return running;},
  _fileName:fileName
 };
}
module.exports={createCache:createCache,fileName:fileName,id:crypto.randomUUID};
