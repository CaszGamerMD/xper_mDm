import test from 'node:test';
import assert from 'node:assert/strict';
import {deckPlan,synergyFeatures,cohesionReport} from '../synergy.mjs';
import {parseDecklist,importDecklist,DeckLibrary,simulateMatch,simulateSeries} from '../playtest.mjs';
function card(name,type='Creature — Frog',cmc=2,oracle=''){
  return {name,type,type_line:type,cmc,oracle_text:oracle,quantity:1,power:'2',toughness:'2',
    mana_cost:'{2}',color_identity:[],keywords:[],land:type.includes('Land'),
    basic:type.includes('Basic'),eligible:true,commander:type.includes('Legendary Creature')};
}
function deck(name) {
  const cards=[
    ...Array.from({length:37},(_,i)=>({...card('Forest','Basic Land — Forest',0),quantity:1})),
    ...Array.from({length:62},(_,i)=>card('Frog '+i,'Creature — Frog',1+(i%4),'When this creature enters, draw a card.'))
  ];
  return {name,commander:card(name,'Legendary Creature — Frog',3,'Frogs you control get +1/+1.'),
    total_cards:100,groups:[{role:'Main',cards}],cohesion:{planKey:'tribal'}};
}
test('synergy recognizes actual enablers and payoffs instead of isolated generic cards',()=>{
  const commander=card('Token captain','Legendary Creature — Human',4,'Whenever you create a creature token, draw a card.');
  assert.equal(deckPlan(['tokens'],commander),'tokens');
  const starter=card('Create sprouts','Sorcery',2,'Create two 1/1 green Saproling creature tokens.');
  const payoff=card('Buff tokens','Enchantment',4,'Creatures you control get +1/+1.');
  const unrelated=card('Quiet stone','Artifact',2,'Scry 1.');
  assert.ok(synergyFeatures(starter,'tokens',[],commander).score>synergyFeatures(unrelated,'tokens',[],commander).score);
  assert.ok(synergyFeatures(payoff,'tokens',[],commander).payoff);
  const report=cohesionReport([starter,payoff,unrelated],'tokens',[],commander);
  assert.equal(report.enablers,1);
  assert.equal(report.payoffs,1);
  assert.ok(report.warnings.some(w=>w.includes('payoff')));
});
test('tribal decks require creature-type payload and tribal payoffs',()=>{
  const commander=card('Frog Captain','Legendary Creature — Frog',3,'Frogs you control get +1/+1.');
  const report=cohesionReport([card('Froglet'),card('Frog Lord','Creature — Frog',3,'Other Frogs you control get +1/+1.')],null,['Frog'],commander);
  assert.equal(report.enablers,2);assert.equal(report.payoffs,1);
  assert.equal(report.planKey,'tribal');
});
test('parses conventional commander decklists with optional explicit commander',()=>{
  const entries=Array.from({length:99},(_,i)=>'1 Card '+i).join('\n');
  const parsed=parseDecklist('// Commander\n1 Frog King\n\n// Deck\n'+entries);
  assert.equal(parsed.commander,'Frog King');assert.equal(parsed.entries.length,99);
  const parsed2=parseDecklist('1 Frog King\n'+entries,'Frog King');
  assert.equal(parsed2.entries.length,99);
  assert.throws(()=>parseDecklist('// Commander\n1 Frog King\n// Deck\n1 Sol Ring'),/99 main-deck cards/);
  assert.throws(()=>parseDecklist('1 Frog King\n'+entries),/commander name/);
});
test('saves 100-card decks only to injected local storage and deletes them',()=>{
  const store=new Map();const storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)};
  const lib=new DeckLibrary(storage);
  assert.equal(lib.list().length,0);
  const id=lib.save(deck('Frog Captain'),'Frog swarm');
  assert.equal(lib.list()[0].name,'Frog swarm');
  assert.equal(lib.get(id).total_cards,100);
  lib.remove(id);assert.equal(lib.get(id),null);
});
test('match simulation is deterministic, includes named actions, and is explicitly projected',()=>{
  const mine=deck('Frog King'),theirs=deck('Frog Opponent');
  const a=simulateMatch(mine,theirs,{seed:123,turns:6});
  const b=simulateMatch(mine,theirs,{seed:123,turns:6});
  assert.deepEqual(a,b);
  assert.match(a.log.join('\n'),/TURN 1/);
  assert.ok(['your deck','opponent','draw'].includes(a.winner));
  const series=simulateSeries(mine,theirs,6,123);
  assert.equal(series.count,6);
  assert.equal(series.wins+series.losses+series.draws,6);
  assert.throws(()=>simulateMatch({...mine,total_cards:99},theirs),/100-card/);
});
test('import validates names, card legality and identity before saving',async()=>{
  const commander=card('Frog King','Legendary Creature — Frog',3,'');
  const catalogue=new Map([['Frog King',commander]]);
  for(let i=0;i<99;i++)catalogue.set('Frog '+i,card('Frog '+i));
  const source={named:async name=>catalogue.get(name)||null,
    collection:async names=>names.map(name=>catalogue.get(name)).filter(Boolean)};
  const text='// Commander\n1 Frog King\n// Deck\n'+Array.from({length:99},(_,i)=>'1 Frog '+i).join('\n');
  const imported=await importDecklist(text,'',source);
  assert.equal(imported.total_cards,100);
  assert.equal(imported.groups[0].cards.length,99);
  await assert.rejects(()=>importDecklist(text.replace('Frog 17','Unknown Frog'),'',source),/could not be verified/);
});
