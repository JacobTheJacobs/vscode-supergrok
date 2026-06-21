const { spawn } = require('node:child_process');
const fs = require('node:fs');
const GROK = process.env.HOME + '/.grok/bin/grok';
const CWD = '/tmp/grok-probe';
const p = spawn(GROK, ['agent','stdio'], { cwd: CWD, env: process.env });
let buf = '', nextId = 1, sessionId = null;
const raw = fs.createWriteStream('/tmp/imagine-raw.jsonl');
let initId, newId, promptId;

function send(method, params){ const id = nextId++; p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n'); return id; }
function respond(id, result){ p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n'); }

function summarizeUpdate(u){
  if(!u) return;
  const t = u.sessionUpdate;
  if(t === 'agent_message_chunk' || t === 'agent_thought_chunk'){
    const c = u.content;
    if(c && c.type !== 'text'){ console.log('  >> NON-TEXT CHUNK:', JSON.stringify(c).slice(0,400)); }
  } else if(t === 'tool_call' || t === 'tool_call_update'){
    console.log('  >> '+t+': title='+JSON.stringify(u.title)+' kind='+u.kind+' status='+u.status);
    if(u.content) console.log('     content:', JSON.stringify(u.content).slice(0,600));
    if(u.rawInput) console.log('     rawInput keys:', Object.keys(u.rawInput));
  } else {
    console.log('  >> update:', t);
  }
}

function handle(m){
  if(m.id!=null && m.method==null){
    if(m.id===initId){ newId = send('session/new',{cwd:CWD, mcpServers:[]}); }
    else if(m.id===newId){ sessionId=m.result && m.result.sessionId; console.log('session', sessionId, 'model', m.result && m.result.models && m.result.models.currentModelId); promptId = send('session/prompt',{sessionId, prompt:[{type:'text',text:'/imagine a small red cube on white background'}]}); console.log('sent /imagine prompt...'); }
    else if(m.id===promptId){ console.log('PROMPT DONE. stopReason=', m.result && m.result.stopReason); setTimeout(function(){ raw.end(); p.kill(); process.exit(0); }, 1000); }
    return;
  }
  if(m.method==='session/update'){ summarizeUpdate(m.params && m.params.update); return; }
  if(m.method){ console.log('SERVER REQ:', m.method, m.params && m.params.path ? '('+m.params.path+')' : ''); if(m.id!=null) respond(m.id, {}); return; }
}

p.stdout.on('data', function(d){
  buf += d;
  let i;
  while((i = buf.indexOf('\n')) >= 0){
    const line = buf.slice(0,i);
    buf = buf.slice(i+1);
    if(!line.trim()) continue;
    raw.write(line+'\n');
    let m;
    try { m = JSON.parse(line); } catch(e){ console.log('NONJSON', line.slice(0,120)); continue; }
    handle(m);
  }
});
p.stderr.on('data', function(d){ console.log('STDERR', d.toString().slice(0,200)); });
p.on('exit', function(c){ console.log('EXIT', c); });
initId = send('initialize',{protocolVersion:1, clientCapabilities:{fs:{readTextFile:true,writeTextFile:true}, terminal:true}});
setTimeout(function(){ console.log('TIMEOUT'); raw.end(); p.kill(); process.exit(0); }, 90000);
