import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretPrompt} from '../intent.mjs';
import {primaryType,sortedCardGroups,averageSpellManaValue} from '../presentation.mjs';
import {BrowserGenerator,DeckInputError} from '../generator.mjs';

test('prompt detects mechanics and tribes from sentences without treating every word as a search term',()=>{
  const parsed=interpretPrompt('I want Frogs with ETB blink effects, and lots of tokens!');
  assert.deepEqual(parsed.creature_types,['Frog']);
  assert.deepEqual(parsed.keywords,['blink','tokens']);
  assert.deepEqual(interpretPrompt('A friendly story with nothing about mechanics.'),{creature_types:[],keywords:[]});
});
test('each card is grouped once and sorted by mana value inside types',()=>{
  const deck={groups:[{cards:[
    {name:'Late Frog',type:'Creature — Frog',cmc:5,quantity:1},
    {name:'Quick Frog',type:'Creature — Frog',cmc:1,quantity:1},
    {name:'Artifact Frog',type:'Artifact Creature — Frog',cmc:2,quantity:1},
    {name:'Artifact Land',type:'Artifact Land',cmc:0,quantity:1},
    {name:'Instant',type:'Instant',cmc:2,quantity:1}
  ]}]};
  assert.equal(primaryType(deck.groups[0].cards[2]),'Creature');
  assert.equal(primaryType(deck.groups[0].cards[3]),'Land');
  const groups=sortedCardGroups(deck);
  assert.deepEqual(groups.find(g=>g.name==='Creature').cards.map(c=>c.name),['Quick Frog','Artifact Frog','Late Frog']);
  assert.equal(groups.reduce((sum,g)=>sum+g.cards.length,0),5);
  assert.equal(sortedCardGroups(deck,'cmc-type')[0].cards[0].name,'Artifact Land');
});
test('average mana value does not count any lands or the commander',()=>{
  // The input is main-deck-only: a commander is deliberately not supplied.
  const cards=[{type_line:'Creature',cmc:2,land:false},{type_line:'Instant',cmc:4,land:false},
    {type_line:'Artifact Land',cmc:8,land:true},{type_line:'Land',cmc:9,land:true}];
  assert.equal(averageSpellManaValue(cards),3);
});

function card(name,type='Artifact',cmc=2,colors=[],text='') {
  return {name,oracle_id:name,type_line:type,oracle_text:text,mana_cost:'{1}',cmc,
    color_identity:colors,keywords:[],edhrec_rank:100,produced_mana:[],image:'',url:'',
    land:type.includes('Land'),basic:type.includes('Basic'),creature:type.includes('Creature'),
    commander:type.includes('Legendary Creature'),eligible:true};
}
class VariedCatalog {
  constructor(){
    this.king=card('Frog King','Legendary Creature — Frog',4,['G'],'Frogs draw cards');
    this.fav=card('Favorite Frog','Creature — Frog',7,['G'],'Frogs');
    this.spells=[];
    const roles=[['Ramp','Add {G}.'],['Draw','Draw a card.'],['Removal','Destroy target creature.'],
      ['Protection','Target creature gains hexproof.'],['Wipe','Destroy all creatures.'],
      ['Finisher','Each opponent loses 1 life.'],['Synergy','Frogs you control get +1/+1.']];
    for(const [role,text] of roles) for(let i=0;i<36;i++)
      this.spells.push(card(`${role} ${i}`,role==='Synergy'?'Creature — Frog':'Artifact',1+(i%7),[],text));
    this.basics=['Plains','Island','Swamp','Mountain','Forest','Wastes'].map(name=>card(name,'Basic Land — '+name,0,[],'{T}: Add {G}.')); 
    this.lands=Array.from({length:50},(_,i)=>card(`Utility ${i}`,'Land',0,[],'{T}: Add {G}.'));
  }
  async named(name){return {'Frog King':this.king,'Favorite Frog':this.fav}[name]||null;}
  async collection(names){return this.basics.filter(c=>names.includes(c.name));}
  async search(q,n){return q.includes('is:commander')?[this.king]:q.includes('t:land -t:basic')?this.lands.slice(0,n):this.spells.slice(0,n);}
}
test('requested average affects real chosen cards, preserves favorites and reports actual value',async()=>{
  const forge=new BrowserGenerator(new VariedCatalog());
  const base={commander:'Frog King',favorites:['Favorite Frog'],options:1,prompt:'a Frog blink deck'};
  const low=(await forge.generate({...base,target_cmc:2.3}))[0];
  const high=(await forge.generate({...base,target_cmc:4.6}))[0];
  assert.equal(low.total_cards,100);
  assert.equal(high.total_cards,100);
  assert.match(low.export,/1 Favorite Frog/);
  assert.match(high.export,/1 Favorite Frog/);
  assert.ok(low.average_cmc < high.average_cmc,`low=${low.average_cmc}, high=${high.average_cmc}`);
  assert.ok(Math.abs(low.average_cmc-2.3)<=.25,`achieved low=${low.average_cmc}`);
  assert.ok(Math.abs(high.average_cmc-4.6)<=.25,`achieved high=${high.average_cmc}`);
  assert.equal(low.target_cmc,2.3);
  assert.equal(high.target_cmc,4.6);
});
test('rejects invalid mana-value targets',async()=>{
  await assert.rejects(()=>new BrowserGenerator(new VariedCatalog()).generate({target_cmc:12,options:1}),DeckInputError);
});
