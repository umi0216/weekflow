import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});
const browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--remote-debugging-port=9224','--remote-allow-origins=http://localhost:9224',
  '--user-data-dir='+fileURLToPath(new URL('../.runtime/qa-browser',import.meta.url)),
  'about:blank'
],{windowsHide:true,stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let ws, next=0;const pending=new Map(),errors=[];let knownMembers=[];
try{
  let targets;
  for(let i=0;i<60;i++){try{targets=await(await fetch('http://127.0.0.1:9224/json/list')).json();if(targets.some(t=>t.type==='page'))break}catch{}await delay(200)}
  assert.ok(targets,'browser did not start');
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(new Error(JSON.stringify(m.error)));else p?.resolve(m.result)}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''))};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
  const until=async(expression,label)=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await delay(100)}throw new Error('Timed out: '+label)};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const shot=async name=>{const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(new URL('../outputs/'+name+'.png',import.meta.url),Buffer.from(r.data,'base64'))};
  await cdp('Page.enable');await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:'http://127.0.0.1:4173/'});
  await until(`!!document.querySelector('.welcome')`,'welcome');
  await shot('welcome-desktop');
  console.log('PASS: empty onboarding and desktop layout');
  async function createMember(name){await click('[data-action="add-member"]');await fill('#member-form [name="name"]',name);await fill('#member-form [name="role"]','测试成员');await evaluate(`document.querySelector('#member-form').requestSubmit()`);await until(`!document.querySelector('#member-form') && document.querySelector('.heading-title').textContent.includes(${JSON.stringify(name)})`,'member created');const data=await(await fetch('http://127.0.0.1:4173/api/state')).json();const member=data.members.find(m=>m.name===name);knownMembers.push(member.id);return member}
  const a=await createMember('QA 林小满');
  await click('[data-action="add-task"]');await fill('#task-form [name="title"]','评审交互方案');await fill('#task-form [name="description"]','需要完成可编辑的任务流程。\n同时检查创建时间。');await fill('#task-form [name="priority"]','high');await evaluate(`document.querySelector('#task-form').requestSubmit()`);
  await until(`!!document.querySelector('.todo .task-card') && !document.querySelector('#task-form')`,'new todo');
  assert.ok(await evaluate(`document.querySelector('.card-time').textContent.trim().length>5`));
  const rect=await evaluate(`(()=>{const r=document.querySelector('.task-card .task-title').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for(const clickCount of [1,2]){await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount,...rect});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount,...rect});await delay(70)}
  await until(`!!document.querySelector('.progress .task-card')`,'double click advances');await delay(400);assert.equal(await evaluate(`!!document.querySelector('.dialog')`),false);
  await click('#undo-action');await until(`!!document.querySelector('.todo .task-card')`,'undo restores todo');
  console.log('PASS: create task, timestamps, actual double-click, undo');
  await click('.card-edit');await fill('#task-form [name="title"]','评审方案 <img src=x onerror=alert(1)>');await fill('#task-form [name="status"]','review');await evaluate(`document.querySelector('#task-form').requestSubmit()`);
  await until(`!!document.querySelector('.review .task-card') && !document.querySelector('#task-form')`,'edit and status');
  assert.equal(await evaluate(`!!document.querySelector('.task-title img')`),false);
  const b=await createMember('QA 周亦舟');assert.equal(await evaluate(`document.querySelectorAll('.task-card').length`),0);
  await click(`[data-member="${a.id}"]`);await until(`!!document.querySelector('.review .task-card')`,'member switch');
  await cdp('Page.reload');await until(`!!document.querySelector('.review .task-card')`,'reload persistence');
  await fill('#task-search','不存在的任务');await until(`!!document.querySelector('.filter-empty')`,'search filter');await click('[data-action="clear-filters"]');
  await click('[data-view="list"]');await until(`document.querySelectorAll('.task-list-row').length===2`,'list view');await click('[data-view="board"]');
  console.log('PASS: editing, safe text rendering, member isolation, reload, search, list view');
  await evaluate(`(()=>{const card=document.querySelector('.task-card');const data=new DataTransfer();data.setData('text/plain',card.dataset.task);document.querySelector('.done').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()`);
  await until(`!!document.querySelector('.done .task-card')`,'drag to completed');
  await click('.card-edit');assert.ok(await evaluate(`document.querySelector('.task-meta').textContent.includes('完成于')`));await click('#delete-task');await click('#cancel-delete');await until(`!!document.querySelector('#task-form')`,'cancel deletion returns to task');await click('#delete-task');await click('#confirm-delete');await until(`!document.querySelector('.dialog') && !document.querySelector('.task-card')`,'delete task');
  console.log('PASS: drag across stages, completion timestamp, deletion confirmation and cancellation');
  await click('[data-action="overview"]');assert.equal(await evaluate(`document.querySelectorAll('.member-card').length`),2);
  await evaluate(`localStorage.removeItem('weekflow.member');localStorage.removeItem('weekflow.view')`);
  // Clean up only the two members created by this test, preserving all other records.
  for(const id of knownMembers)await fetch('http://127.0.0.1:4173/api/members/'+id,{method:'DELETE'});knownMembers=[];
  await cdp('Page.reload');await until(`!!document.querySelector('.welcome')`,'real workspace remains empty');
  await click('[data-action="demo"]');await until(`document.querySelectorAll('.task-card').length===7`,'demo board');
  assert.equal(await evaluate(`document.querySelectorAll('.week-section').length`),2);
  await shot('board-desktop');
  const overflows=await evaluate(`Array.from(document.querySelectorAll('.task-card')).filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.innerText)`);assert.deepEqual(overflows,[]);
  await click('.week-collapse');assert.equal(await evaluate(`document.querySelector('.week-collapse').getAttribute('aria-expanded')`),'false');await click('.week-collapse');
  await fill('#week-filter',await evaluate(`document.querySelector('#week-filter').options[2].value`));await until(`document.querySelectorAll('.task-card').length===2`,'last week filter');await click('[data-action="overview"]');
  // Full demo board on mobile with no page-level horizontal overflow.
  await click('[data-member="demo-lin"]');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(250);
  assert.equal(await evaluate(`document.documentElement.scrollWidth>window.innerWidth`),false);
  await shot('board-mobile');
  await click('[data-action="open-drawer"]');assert.equal(await evaluate(`document.querySelector('.sidebar').classList.contains('open')`),true);await click('[data-member="demo-zhou"]');assert.equal(await evaluate(`document.querySelector('.sidebar').classList.contains('open')`),false);
  await click('[data-action="add-task"]');assert.equal(await evaluate(`document.querySelector('.dialog').getBoundingClientRect().right<=window.innerWidth`),true);await shot('task-mobile');await click('[data-close]');
  await click('[data-action="exit-demo"]');await until(`!!document.querySelector('.welcome')`,'demo exit');
  assert.equal((await(await fetch('http://127.0.0.1:4173/api/state')).json()).members.length,0);
  assert.deepEqual(errors,[]);console.log('PASS: week groups, collapse, week filter, mobile layout, drawer, modal, demo isolation');
  console.log('Browser QA passed. Screenshots in outputs/.');
}catch(error){console.error(error);process.exitCode=1}
finally{for(const id of knownMembers)await fetch('http://127.0.0.1:4173/api/members/'+id,{method:'DELETE'}).catch(()=>{});ws?.close();browser.kill()}
