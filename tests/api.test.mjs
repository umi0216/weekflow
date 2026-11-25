import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../worker/api.mjs';
import { database } from '../scripts/database.mjs';
let DB;
beforeEach(()=>{DB=database()});
afterEach(()=>DB.close());
async function call(path, method='GET', payload, headers={}) {
  const response=await api(new Request('https://team.example/api'+path,{method,headers:{'Content-Type':'application/json',...headers},...(payload!==undefined?{body:JSON.stringify(payload)}:{})}),{DB});
  return {status:response.status,body:await response.json()};
}
async function member(name='林小满') {const r=await call('/members','POST',{name,role:'设计',color:'sage'});assert.equal(r.status,201);return r.body}
async function task(memberId) {const r=await call('/tasks','POST',{memberId,title:'完成方案',description:'记录细节',priority:'high',status:'done'});assert.equal(r.status,201);return r.body}
test('starts empty; creates distinct member spaces and server timestamps; new tasks always enter TODO',async()=>{
  assert.deepEqual((await call('/state')).body,{members:[],tasks:[]});
  const a=await member(),b=await member('周亦舟');const t=await task(a.id);
  assert.equal(t.memberId,a.id);assert.equal(t.status,'todo');assert.equal(t.version,1);
  assert.ok(Math.abs(Date.now()-Date.parse(t.createdAt))<2000);assert.equal(t.completedAt,null);
  const state=(await call('/state')).body;assert.equal(state.members.length,2);assert.equal(state.tasks.length,1);assert.notEqual(a.id,b.id);
});
test('four-stage workflow keeps creation time and detects stale updates and deletes',async()=>{
  const m=await member();let t=await task(m.id);const createdAt=t.createdAt;
  for(const status of ['progress','review','done']){const r=await call('/tasks/'+t.id,'PATCH',{status,version:t.version});assert.equal(r.status,200);t=r.body;assert.equal(t.status,status);assert.equal(t.createdAt,createdAt)}
  assert.ok(t.completedAt);assert.equal(t.version,4);
  assert.equal((await call('/tasks/'+t.id,'PATCH',{status:'todo',version:1})).status,409);
  assert.equal((await call('/tasks/'+t.id,'DELETE',{version:1})).status,409);
  t=(await call('/tasks/'+t.id,'PATCH',{status:'todo',title:'修订方案',version:4})).body;
  assert.equal(t.completedAt,null);assert.equal(t.title,'修订方案');
  assert.equal((await call('/tasks/'+t.id,'DELETE',{version:5})).status,200);
  assert.equal((await call('/state')).body.tasks.length,0);
});
test('validates input, duplicate members, nonexistent membership and cross-origin mutations',async()=>{
  const m=await member();
  assert.equal((await call('/members','POST',{name:'林小满',color:'blue'})).status,409);
  assert.equal((await call('/members','POST',{name:' ',color:'blue'})).status,400);
  assert.equal((await call('/members','POST',{name:'无效',color:'red'})).status,400);
  assert.equal((await call('/tasks','POST',{memberId:'unknown',title:'测试'})).status,404);
  assert.equal((await call('/tasks','POST',{memberId:m.id,title:'a'.repeat(121)})).status,400);
  assert.equal((await call('/members','POST',{name:'外部',color:'sage'},{Origin:'https://other.example'})).status,403);
  const t=await task(m.id);assert.equal((await call('/tasks/'+t.id,'PATCH',{status:'unknown',version:1})).status,400);
});
test('member edits persist; deleting a member cascades only its tasks',async()=>{
  const a=await member(),b=await member('陈可');await task(a.id);const keep=await task(b.id);
  const updated=await call('/members/'+a.id,'PATCH',{name:'林小满（设计）',role:'产品设计',color:'rose'});
  assert.equal(updated.status,200);assert.equal(updated.body.color,'rose');assert.equal(updated.body.createdAt,a.createdAt);
  assert.equal((await call('/members/'+a.id,'DELETE')).status,200);
  const state=(await call('/state')).body;assert.equal(state.members.length,1);assert.equal(state.members[0].id,b.id);assert.deepEqual(state.tasks.map(t=>t.id),[keep.id]);
});
