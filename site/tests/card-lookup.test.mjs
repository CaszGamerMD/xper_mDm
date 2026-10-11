import test from 'node:test';
import assert from 'node:assert/strict';
import {cardNameKey,cardFaceNames,matchesCardName,resolveCardNames,lookupNamedCard} from '../card-lookup.mjs';
import {DeckDoctor} from '../deck-doctor.mjs';
import {importDecklist} from '../playtest.mjs';
const FULL='Halvar, God of Battle // Sword of the Realms';
const FRONT='Halvar, God of Battle';
const BACK='Sword of the Realms';
const halvar={name:FULL,type_line:'Legendary Creature — God // Legendary Artifact — Equipment',
  oracle_text:'Creatures you control that are enchanted or equipped have double strike.\\nEquipped creature gets +2/+0.',
  color_identity:['W'],cmc:4,creature:true,land:false,basic:false,eligible:true,
  commander:true,keywords:[],mana_cost:'{2}{W}{W}',oracle_id:'halvar-canonical'};
const commander={name:'White Commander',type_line:'Legendary Creature — Human',
  oracle_text:'',color_identity:['W'],eligible:true,commander:true,creature:true,land:false,basic:false,cmc:3,keywords:[],mana_cost:'{2}{W}'};
const plains={name:'Plains',type_line:'Basic Land — Plains',color_identity:[],land:true,basic:true,creature:false,eligible:true,commander:false,cmc:0,keywords:[],mana_cost:''};
const solring={name:'Sol Ring',type_line:'Artifact',color_identity:[],land:false,basic:false,creature:false,eligible:true,commander:false,cmc:1,keywords:[],mana_cost:'{1}'};
class BrokenBulkSource {
  constructor(){this.bulk=[];this.namedCalls=[];}
  async collection(names){
    this.bulk.push([...names]);
    // Simulates Scryfall providing no result for a full printed DFC name;
    // the front-face bulk lookup correctly returns the canonical combined card.
    return names.flatMap(name=>{
      if(name===FRONT||name===BACK)return [halvar];
      if(name==='White Commander')return [commander];
      if(name==='Plains')return [plains];
      if(name==='Sol Ring')return [solring];
      return [];
    });
  }
  async named(name){
    this.namedCalls.push(name);
    if(name===FRONT)return halvar;
    if(name==='White Commander')return commander;
    return null;
  }
}
const makeList=(dfc=FULL,leader='White Commander')=>
  '// Commander\\n1 '+leader+'\\n// Deck\\n97 Plains\\n1 Sol Ring\\n1 '+dfc+'\\n';
test('canonical DFC names compare with normalized front/back spacing',()=>{
  assert.equal(cardNameKey(' HALVAR, God of Battle//Sword of the Realms '),cardNameKey(FULL));
  assert.deepEqual(cardFaceNames(FULL),[FRONT,BACK]);
  assert.equal(matchesCardName(FULL,halvar),true);
  assert.equal(matchesCardName(FRONT,halvar),true);
  assert.equal(matchesCardName(BACK,halvar),true);
  assert.equal(matchesCardName('Halvar, God of Battle // Sword of Mistakes',halvar),false);
});
test('failed full-name bulk lookup retries front face and retains canonical card',async()=>{
  const source=new BrokenBulkSource();
  const found=await resolveCardNames([FULL,'Plains','Sol Ring'],source);
  assert.equal(found.get(cardNameKey(FULL))?.name,FULL);
  assert.ok(source.bulk.some(batch=>batch.includes(FULL)));
  assert.ok(source.bulk.some(batch=>batch.includes(FRONT)));
  assert.equal(source.namedCalls.length,0);
});
test('front-face-only deck entries match returned full double-faced cards',async()=>{
  const source=new BrokenBulkSource();
  const found=await resolveCardNames([FRONT],source);
  assert.equal(found.get(cardNameKey(FRONT)).name,FULL);
});
test('the named endpoint retries front face for full DFC commanders',async()=>{
  const source=new BrokenBulkSource();
  const leader=await lookupNamedCard(FULL,source);
  assert.equal(leader.name,FULL);
  assert.deepEqual(source.namedCalls,[FULL,FRONT]);
});
test('incorrect back faces cannot silently resolve to the right front card',async()=>{
  const source=new BrokenBulkSource();
  const invalid=FRONT+' // Wrong Sword';
  const found=await resolveCardNames([invalid],source);
  assert.equal(found.has(cardNameKey(invalid)),false);
  assert.equal(await lookupNamedCard(invalid,source),null);
});
test('Deck Doctor imports and keeps Halvar as a valid canonical card with its white color identity',async()=>{
  const source=new BrokenBulkSource();
  const doctor=new DeckDoctor(source);
  const loaded=await doctor.loadList(makeList());
  assert.equal(loaded.cards.length,99);
  assert.equal(loaded.cards.filter(c=>c.name===FULL).length,1);
  assert.deepEqual(loaded.cards.find(c=>c.name===FULL).color_identity,['W']);
  assert.equal(loaded.cards.filter(c=>c.name==='Plains').length,97);
  assert.match(loaded.commander.name,/White Commander/);
  const named=await doctor.loadList(makeList(FRONT));
  assert.equal(named.cards.filter(c=>c.name===FULL).length,1);
});
test('opponent import shares the same DFC name resolution and canonically exports card name',async()=>{
  const source=new BrokenBulkSource();
  const imported=await importDecklist(makeList(),'',source);
  const cards=imported.groups.flatMap(g=>g.cards);
  assert.ok(cards.some(c=>c.name===FULL));
  assert.match(imported.export,/Halvar, God of Battle/);
});
test('DFC duplicates entered under full and front names fail singleton validation',async()=>{
  const source=new BrokenBulkSource();
  const bad='// Commander\\n1 White Commander\\n// Deck\\n96 Plains\\n1 Sol Ring\\n1 '+FULL+'\\n1 '+FRONT+'\\n';
  await assert.rejects(()=>new DeckDoctor(source).loadList(bad),/Singleton violation/);
  await assert.rejects(()=>importDecklist(bad,'',source),/singleton violation/);
});
test('Halvar can be resolved when the double-faced card is the deck commander',async()=>{
  const source=new BrokenBulkSource();
  const list='// Commander\\n1 '+FULL+'\\n// Deck\\n98 Plains\\n1 Sol Ring\\n';
  const deck=await new DeckDoctor(source).loadList(list);
  assert.equal(deck.commander.name,FULL);
  assert.equal(deck.cards.length,99);
});
