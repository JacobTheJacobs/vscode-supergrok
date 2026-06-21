const { spawn } = require('node:child_process');
const fs = require('node:fs');
const GROK = process.env.HOME + '/.grok/bin/grok';
const CWD = '/tmp/grok-probe';
const p = spawn(GROK, ['--always-approve','agent','stdio'], { cwd: CWD, env: process.env });
let buf='', nextId=1, sessionId=null, initId,newId,promptId;
const raw = fs.createWriteStream('/tmp/video2-raw.jsonl');
function send(method,params){const id=nextId++;p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');return id;}
function respond(id,result){p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');}
function err(id,code,msg){p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,error:{code,message:msg}})+'\n');}
function handle(m){
  if(m.id!=null && m.method==null){
    if(m.id===initId){ newId=send('session/new',{cwd:CWD,mcpServers:[]}); }
    else if(m.id===newId){ sessionId=m.result&&m.result.sessionId; console.log('session',sessionId); promptId=send('session/prompt',{sessionId,prompt:[{type:'text',text:'Use the imagine video tools: generate a source image of a red cube, then animate it into a short 6s video with image_to_video. If video tools are unavailable, say so.'}]}); console.log('sent video prompt...'); }
    else if(m.id===promptId){ console.log('DONE',m.result&&m.result.stopReason); setTimeout(()=>{raw.end();p.kill();process.exit(0);},1500); }
    return;
  }
  if(m.method==='session/update'){ const u=m.params&&m.params.update; if(!u)return; raw.write(JSON.stringify(u)+'\n'); const t=u.sessionUpdate;
    if(t==='tool_call'||t==='tool_call_update'){
      const title=JSON.stringify(u.title);
      if(/video|image_gen|imagine/i.test(title) || (u.rawInput&&/video|imagegen/i.test(JSON.stringify(u.rawInput)))){
        console.log('  '+t+': title='+title+' status='+u.status+' id='+u.toolCallId);
        if(u.rawInput) console.log('     rawInput:',JSON.stringify(u.rawInput).slice(0,250));
        if(u.content) console.log('     content:',JSON.stringify(u.content).slice(0,600));
      }
    } else if(t==='agent_message_chunk'){ const c=u.content; if(c&&c.text&&/video|unavail|cannot|saved/i.test(c.text)) process.stdout.write(c.text); }
    return;
  }
  if(m.method){
    const meth=m.method;
    if(meth==='fs/read_text_file'){ try{ respond(m.id,{content:fs.readFileSync(m.params.path,'utf8')}); }catch(e){ err(m.id,-32603,String(e.message)); } return; }
    if(meth==='fs/write_text_file'){ try{ fs.mkdirSync(require('path').dirname(m.params.path),{recursive:true}); fs.writeFileSync(m.params.path,m.params.content); }catch(e){} respond(m.id,{}); return; }
    if(meth==='session/request_permission'){ const o=(m.params.options||[]).find(x=>/allow/.test(x.kind))||m.params.options[0]; respond(m.id,{outcome:{outcome:'selected',optionId:o&&o.optionId}}); return; }
    if(/terminal\/create/.test(meth)){ respond(m.id,{terminalId:'t'+nextId}); return; }
    if(/terminal\/output/.test(meth)){ respond(m.id,{output:'',exitStatus:{exitCode:0},truncated:false}); return; }
    if(/terminal\/wait_for_exit/.test(meth)){ respond(m.id,{exitCode:0}); return; }
    if(m.id!=null) respond(m.id,{});
    return;
  }
}
p.stdout.on('data',function(d){buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;let m;try{m=JSON.parse(line);}catch(e){continue;}handle(m);}});
p.stderr.on('data',d=>{const s=d.toString();if(/video|imagine|moderation|block/i.test(s))console.log('STDERR',s.slice(0,160));});
p.on('exit',c=>console.log('EXIT',c));
initId=send('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:true,writeTextFile:true},terminal:true}});
setTimeout(()=>{console.log('TIMEOUT');raw.end();p.kill();process.exit(0);},280000);
