const { spawn } = require('node:child_process');
const fs = require('node:fs');
const GROK = process.env.HOME + '/.grok/bin/grok';
const CWD = '/tmp/grok-probe';
// the session that generated the image earlier
const SID = '019ea6ff-1b3b-74f1-8483-fab33e850823';
const p = spawn(GROK, ['agent','stdio'], { cwd: CWD, env: process.env });
let buf='', nextId=1, initId, loadId;
function send(method,params){const id=nextId++;p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');return id;}
function respond(id,result){p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');}
function handle(m){
  if(m.id!=null && m.method==null){
    if(m.id===initId){ console.log('--- loading session (replay below) ---'); loadId=send('session/load',{sessionId:SID,cwd:CWD,mcpServers:[]}); }
    else if(m.id===loadId){ console.log('LOAD DONE'); setTimeout(()=>{p.kill();process.exit(0);},500); }
    return;
  }
  if(m.method==='session/update'){ const u=m.params&&m.params.update; if(!u)return; const t=u.sessionUpdate;
    if(t==='tool_call'||t==='tool_call_update'){
      let line='  '+t+': title='+JSON.stringify(u.title)+' status='+u.status+' id='+u.toolCallId;
      console.log(line);
      if(u.rawInput) console.log('     rawInput:',JSON.stringify(u.rawInput).slice(0,160));
      if(u.content) console.log('     content:',JSON.stringify(u.content).slice(0,400));
    } else if(t==='user_message_chunk'||t==='agent_message_chunk'){
      const c=u.content; console.log('  '+t+': '+(c&&c.type)+' '+JSON.stringify(c&&c.text||'').slice(0,60));
    } else console.log('  '+t);
    return;
  }
  if(m.method){ if(m.id!=null) respond(m.id,{}); return; }
}
p.stdout.on('data',function(d){buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;let m;try{m=JSON.parse(line);}catch(e){continue;}handle(m);}});
p.stderr.on('data',d=>{const s=d.toString();if(/error|panic/i.test(s))console.log('STDERR',s.slice(0,120));});
p.on('exit',c=>console.log('EXIT',c));
initId=send('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:true,writeTextFile:true},terminal:true}});
setTimeout(()=>{console.log('TIMEOUT');p.kill();process.exit(0);},40000);
