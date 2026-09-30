import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../figma/bridge-ui.js', import.meta.url),'utf8');
const tick = () => new Promise(resolve=>setImmediate(resolve));
function harness({wrongToken=false,retryResult=false,cryptoMode='uuid',replyOrigin=null,handshakeReplies=true}={}) {
  const elements = new Map();
  const el = selector => { if(!elements.has(selector))elements.set(selector,{textContent:'',value:'',disabled:false,hidden:false,files:[],classList:{toggle(){}},replaceChildren(){},append(){}});return elements.get(selector); };
  const commands=[],requests=[],handshakeTimers=new Map();let delivered=0,polled=false,resultPosts=0,timerSequence=0;
  let context;
  const dispatch=(message,origin=replyOrigin)=>context.window.onmessage({source:origin===null?parent:{},origin:origin??'null',data:{pluginMessage:message}});
  const reply=(command,origin=replyOrigin)=>{
    const result=command.operation==='get_document'?{name:'Figma file',pageName:'Page 1',pageId:'p1'}:{nodeId:'2:1',count:3};
    dispatch({type:'bridge-result',id:command.id,ok:true,result},origin);
  };
  const parent={postMessage:({pluginMessage:m})=>{
    commands.push(m);
    if(m.operation==='get_document'&&!handshakeReplies)return;
    queueMicrotask(()=>reply(m));
  }};
  const fetch=async(url,options)=>{
    const route=new URL(url).pathname;requests.push({route,...options});
    if(wrongToken)return {ok:false,status:401,json:async()=>({error:'Invalid token'})};
    if(route==='/v1/connect')return {ok:true,json:async()=>({sessionId:'session-one'})};
    if(route==='/v1/poll'){
      if(!polled){polled=true;return {ok:true,json:async()=>({job:{id:'job-one',operation:'import_capture',payload:{}}})};}
      // Wait forever instead of advancing idle polling in this isolated fixture.
      return new Promise(()=>{});
    }
    if(route==='/v1/result') {resultPosts++;if(retryResult&&resultPosts===1)throw new Error('temporary network');delivered++;return {ok:true,json:async()=>({accepted:true})};}
    return {ok:true,json:async()=>({disconnected:true})};
  };
  const cryptoGlobals=cryptoMode==='absent'?{}:{crypto:cryptoMode==='uuid'?{randomUUID:()=> 'test-client-123'}:{}};
  const setTimeout=(fn,ms)=>{
    if(ms===10000){const id=++timerSequence;handshakeTimers.set(id,fn);return id;}
    return setImmediate(fn);
  };
  const clearTimeout=id=>{if(!handshakeTimers.delete(id))clearImmediate(id);};
  context=vm.createContext({document:{querySelector:el,createElement:()=>({})},window:{},parent,...cryptoGlobals,fetch,URL,AbortSignal,setTimeout,clearTimeout,queueMicrotask,console});
  vm.runInContext(code,context);
  el('#token').value='a-valid-test-pairing-token-123';
  return {el,commands,requests,dispatch,reply,expireHandshake(){for(const [id,fn] of handshakeTimers){handshakeTimers.delete(id);fn();}},get handshakeTimerCount(){return handshakeTimers.size},get delivered(){return delivered},get resultPosts(){return resultPosts}};
}

for(const origin of ['https://www.figma.com','https://figma.com']) {
  test(`Figma Desktop host relay accepts ${origin} when source differs from parent`,async()=>{
    const h=harness({replyOrigin:origin});
    await h.el('#connect').onclick();
    for(let i=0;i<8&&!h.delivered;i++)await tick();
    assert.equal(h.delivered,1);
    assert.equal(h.handshakeTimerCount,0);
    assert.equal(h.commands.filter(command=>command.operation==='import_capture').length,1);
    assert.equal(h.el('#state').textContent,'MCP 연결됨');
    await h.el('#disconnect').onclick();
  });
}

test('non-parent messages from external or lookalike origins cannot resolve the handshake or spoof progress',async()=>{
  const h=harness({handshakeReplies:false});
  const connecting=h.el('#connect').onclick();
  const command=h.commands[0];
  const initialStatus=h.el('#status').textContent;
  for(const origin of ['https://attacker.example','https://www.figma.com.attacker.example','http://www.figma.com','null']) {
    h.reply(command,origin);
    h.dispatch({type:'progress',done:999,total:999},origin);
  }
  await tick();
  assert.equal(h.requests.length,0);
  assert.equal(h.el('#status').textContent,initialStatus);
  assert.equal(h.el('#connect').disabled,true);
  assert.equal(h.handshakeTimerCount,1);
  h.reply(command,'https://www.figma.com');
  await connecting;
  for(let i=0;i<8&&!h.delivered;i++)await tick();
  assert.equal(h.delivered,1);
  assert.equal(h.handshakeTimerCount,0);
  await h.el('#disconnect').onclick();
});

test('read-only handshake timeout restores controls, ignores late replies and permits a fresh connection',async()=>{
  const h=harness({handshakeReplies:false});
  const connecting=h.el('#connect').onclick();
  const expiredCommand=h.commands[0];
  assert.equal(h.handshakeTimerCount,1);
  assert.equal(h.el('#token').disabled,true);
  h.expireHandshake();
  await connecting;
  assert.match(h.el('#status').textContent,/피그마 응답을 받지 못했습니다/);
  assert.equal(h.el('#connect').disabled,false);
  assert.equal(h.el('#token').disabled,false);
  assert.equal(h.el('#state').textContent,'연결 대기');
  assert.equal(h.requests.length,0);
  const retry=h.el('#connect').onclick();
  const freshCommand=h.commands[1];
  assert.notEqual(freshCommand.id,expiredCommand.id);
  h.reply(expiredCommand,'https://www.figma.com');
  await tick();
  assert.equal(h.requests.length,0);
  assert.equal(h.handshakeTimerCount,1);
  h.reply(freshCommand,'https://www.figma.com');
  await retry;
  for(let i=0;i<8&&!h.delivered;i++)await tick();
  assert.equal(h.delivered,1);
  assert.equal(h.handshakeTimerCount,0);
  assert.equal(h.commands.filter(command=>command.operation==='import_capture').length,1);
  assert.equal(h.el('#state').textContent,'MCP 연결됨');
  await h.el('#disconnect').onclick();
});
test('Figma UI connects to chosen document, executes job and delivers native result',async()=>{const h=harness();await h.el('#connect').onclick();for(let i=0;i<8&&!h.delivered;i++)await tick();assert.equal(h.delivered,1);assert.equal(h.commands.filter(c=>c.operation==='import_capture').length,1);assert.equal(h.el('#state').textContent,'MCP 연결됨');assert.match(h.el('#status').textContent,/완료/);const body=JSON.parse(h.requests.find(r=>r.route==='/v1/result').body);assert.equal(body.result.nodeId,'2:1');await h.el('#disconnect').onclick();});
test('result transport retries do not repeat canvas mutation',async()=>{const h=harness({retryResult:true});await h.el('#connect').onclick();for(let i=0;i<12&&!h.delivered;i++)await tick();assert.equal(h.resultPosts,2);assert.equal(h.commands.filter(c=>c.operation==='import_capture').length,1);await h.el('#disconnect').onclick();});
test('authentication failure never begins plugin mutation',async()=>{const h=harness({wrongToken:true});await h.el('#connect').onclick();assert.equal(h.commands.length,1);assert.equal(h.commands[0].operation,'get_document');assert.match(h.el('#status').textContent,/연결 실패/);assert.equal(h.el('#token').disabled,false);});

for(const cryptoMode of ['without-randomUUID','absent']) {
  test(`Figma opaque iframe boots and connects when crypto is ${cryptoMode}`,async()=>{
    const h=harness({cryptoMode});
    assert.match(h.el('#status').textContent,/준비 완료/);
    assert.equal(h.el('#connect').disabled,false);
    await h.el('#connect').onclick();
    for(let i=0;i<8&&!h.delivered;i++)await tick();
    assert.equal(h.delivered,1);
    const connection=h.requests.find(request=>request.route==='/v1/connect');
    const {clientId,document}=JSON.parse(connection.body);
    assert.match(clientId,/^figma-[a-z0-9]+-[a-z0-9]+$/);
    assert.ok(clientId.length>=8&&clientId.length<=160);
    assert.equal(document.pageId,'p1');
    assert.equal(connection.headers.Authorization,'Bearer a-valid-test-pairing-token-123');
    assert.equal(h.el('#state').textContent,'MCP 연결됨');
    await h.el('#disconnect').onclick();
  });
}
