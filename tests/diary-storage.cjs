const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/diary-storage.js'), 'utf8');
const DiaryMonths = require('../js/diary-months.js');
function fixture(depth = 1) {
  const state = {active:true, received:[], writes:[], errors:[], observed:0, stopped:0, server:{}, migrated:0};
  const snap = data => ({data:()=>data, metadata:{}});
  const col = {
    onSnapshot(options, next, error) {state.next=next; state.error=error; return()=>state.stopped++;},
    doc(id) {return {set:async(data,options)=>state.writes.push({id,data,options}),
      update:async(...args)=>state.writes.push({id,args})};}
  };
  const ref = {collection:()=>col, get:async()=>snap(state.server),
    set:async(data,options)=>state.writes.push({root:true,data,options}),
    update:async(data)=>state.writes.push({root:true,data})};
  const helpers = {...DiaryMonths, migrate:async()=>{state.migrated++; return {ok:true};}, catchUp:async()=>{}};
  const context = vm.createContext({DiaryMonths:helpers, console, Date,
    firebase:{firestore:{FieldPath:class {constructor(...parts){this.parts=parts;}},
      FieldValue:{delete:()=>({deleted:true}),serverTimestamp:()=>1}}}});
  vm.runInContext(source,context);
  const storage = context.createDiaryStorage({db:{},ref,field:depth===1?'diary':'sharedDiary',depth,
    current:()=>state.active, receive:map=>state.received.push(map),
    observe:()=>state.observed++, fail:error=>state.errors.push(error)});
  return {state,storage,helpers};
}
const tick = ()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  {
    const {state,storage}=fixture();
    storage.read({diaryStorage:2},{metadata:{}});
    state.next({metadata:{},docs:[{data:()=>({entries:{'2030-01-02':{text:'saved'}}})}]});
    await storage.write('2030-02-02',{text:'new'});
    assert.equal(state.received[0]['2030-01-02'].text,'saved');
    assert.equal(state.writes[0].id,'2030-02');
    assert.deepEqual([...state.writes[0].options.mergeFields[0].parts],['entries','2030-02-02']);
    assert(state.writes.every(w=>!w.root));
    console.log('PASS monthly personal read and cross-month write');
  }
  {
    const {state,storage}=fixture(2);
    storage.read({diaryStorage:2},{metadata:{}});
    await storage.write('2030-01-02',{text:'mine'},'A');
    await storage.remove('2030-01-02','A');
    assert.deepEqual([...state.writes[0].options.mergeFields[0].parts],['entries','2030-01-02','A']);
    assert.deepEqual([...state.writes[1].args[0].parts],['entries','2030-01-02','A']);
    console.log('PASS shared writes and deletes target only the author');
  }
  {
    const {state,storage}=fixture();
    storage.read({diaryStorage:2},{metadata:{}});
    state.next({metadata:{hasPendingWrites:true},docs:[]});
    assert.equal(state.received.length,0);
    state.active=false;
    state.next({metadata:{},docs:[]});state.error(Error('stale'));
    assert.equal(state.received.length,0);assert.equal(state.errors.length,0);
    storage.stop();assert.equal(state.stopped,1);
    console.log('PASS pending and stale account snapshots cannot replace editor data');
  }
  {
    const {state,storage}=fixture();
    storage.read({diary:{}},{metadata:{fromCache:true}});
    await tick();assert.equal(state.migrated,0);
    storage.read({diary:{}},{metadata:{}});
    await tick();assert.equal(state.migrated,1);
    assert.equal(state.writes[0].data.diaryStorage,2);
    console.log('PASS migration requires server data and sets the marker after verification');
  }
  {
    const {state,storage,helpers}=fixture();
    helpers.migrate=async()=>({ok:false});
    storage.read({},{metadata:{}});
    await tick();assert.equal(state.writes.length,0);
    console.log('PASS failed migration verification cannot lock legacy writes');
  }
  {
    const {state,storage,helpers}=fixture();
    let finish;helpers.migrate=()=>new Promise(resolve=>finish=resolve);
    storage.read({},{metadata:{}});await tick();
    storage.stop();finish({ok:true});await tick();
    assert.equal(state.writes.length,0);
    console.log('PASS account switch during migration prevents storage marker changes');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
