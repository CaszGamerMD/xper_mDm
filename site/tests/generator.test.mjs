import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserGenerator,validateDeck,withinIdentity,cardFromScryfall,DeckInputError,ScryfallSource} from '../generator.mjs';

function card(name,type='Artifact',color=[],text='',mana=[]) {
  const basic=type.includes('Basic');
  return {name,oracle_id:name,type_line:type,oracle_text:text,mana_cost:'{2}',cmc:2,
    color_identity:color,legal:true,paper:true,keywords:[],edhrec_rank:100,
    produced_mana:mana,image:'',url:'https://scryfall.com',land:type.includes('Land'),basic,
    creature:type.includes('Creature'),commander:type.includes('Legendary')&&type.includes('Creature'),eligible:true};
}
class FakeCatalog {
  constructor() {
    this.commander=card('Captain of Frogs','Legendary Creature — Frog Wizard',['U','G'],'Frogs you control draw a card');
    this.favorite=card('Favorite Frog','Creature — Frog',['G'],'Trample');
    this.red=card('Red Goblin','Creature — Goblin',['R'],'');
    this.land=card('Favorite Coast','Land',[],'{T}: Add {U}.',['U']);
    this.spells=[];
    for(const [prefix,text] of [['Ramp','Add {G}.'],['Draw','Draw a card.'],['Removal','Destroy target creature.'],
      ['Protection','Target Frog gains hexproof.'],['Wipe','Destroy all creatures.'],['Finisher','Each opponent loses 3 life.'],
      ['Synergy','Frogs you control get +1/+1.']]) {
      for(let i=0;i<40;i++) this.spells.push(card(`${prefix} ${i}`,prefix==='Synergy'?'Creature — Frog':'Artifact',[],text));
    }
    this.lands=Array.from({length:55},(_,i)=>card(`Utility ${i}`,'Land',[],'{T}: Add {G}.',['G']));
    this.basics=Object.entries({W:'Plains',U:'Island',B:'Swamp',R:'Mountain',G:'Forest',C:'Wastes'})
      .map(([c,name])=>card(name,`Basic Land — ${name}`,[],`{T}: Add {${c}}.`,[c]));
  }
  async named(name) {return ({'Captain of Frogs':this.commander,'Favorite Frog':this.favorite,
    'Red Goblin':this.red,'Favorite Coast':this.land})[name]||null;}
  async collection(names) {return this.basics.filter(c=>names.includes(c.name));}
  async search(query,limit=150) {
    if(query.includes('is:commander')) return [this.commander];
    if(query.includes('t:land -t:basic')) return this.lands.slice(0,limit);
    return this.spells.slice(0,limit);
  }
}

test('four complete legal decks with required cards',async()=>{
  const forge=new BrowserGenerator(new FakeCatalog());
  const decks=await forge.generate({commander:'Captain of Frogs',colors:['U','G'],favorites:['Favorite Frog','Favorite Coast'],
    creature_types:['Frog'],keywords:[],options:4});
  assert.equal(decks.length,4);
  for(const deck of decks) {
    assert.equal(deck.total_cards,100);
    assert.match(deck.export,/^\/\/ Commander\n1 Captain of Frogs/m);
    assert.match(deck.export,/1 Favorite Frog/);
    assert.match(deck.export,/1 Favorite Coast/);
    assert.ok(deck.groups.flatMap(g=>g.cards).every(c=>c.quantity>0));
    assert.ok(deck.warnings.every(msg=>typeof msg==='string'));
  }
});

test('off-color favorite is rejected',async()=>{
  await assert.rejects(()=>new BrowserGenerator(new FakeCatalog()).generate({commander:'Captain of Frogs',favorites:['Red Goblin'],options:1}),DeckInputError);
});
test('commander identity is exact when colors are selected',async()=>{
  await assert.rejects(()=>new BrowserGenerator(new FakeCatalog()).generate({commander:'Captain of Frogs',colors:['G'],options:1}),DeckInputError);
});
test('enforces basic land subtype restriction independent of color identity',()=>{
  const commander=card('Red King','Legendary Creature — Human',['R']);
  assert.equal(withinIdentity(card('Hallowed Fountain','Land — Plains Island',[]),commander),false);
  assert.equal(withinIdentity(card('Forest','Basic Land — Forest',[]),commander),false);
  assert.equal(withinIdentity(card('Wastes','Basic Land',[]),commander),true);
});
test('rejects repeated singleton cards',()=>{
  const commander=card('Captain','Legendary Creature — Frog',['G']);
  const repeated=card('Sol Ring');
  const basics=card('Forest','Basic Land — Forest',[], '', ['G']);
  assert.throws(()=>validateDeck({commander,main:[[repeated,'ramp'],[repeated,'draw']],basics:[[basics,97]]}),DeckInputError);
});
test('Scryfall parsing rejects banned cards and handles modal faces',()=>{
  const cardData=cardFromScryfall({id:'uuid',name:'A // B',type_line:'Legendary Creature — Frog // Land — Forest',
    legalities:{commander:'banned'},games:['paper'],card_faces:[{oracle_text:'front',mana_cost:'{1}'},{oracle_text:'back',mana_cost:''}]});
  assert.equal(cardData.eligible,false);
  assert.equal(cardData.commander,true);
  assert.equal(cardData.oracle_text,'front\nback');
});
test('Scryfall client calls direct HTTPS API and caches duplicate lookups',async()=>{
  let requests=0;
  const client=new ScryfallSource(async url=>{requests++;assert.match(url,/^https:\/\/api\.scryfall\.com\/cards\/named/);
    return {ok:true,status:200,json:async()=>({object:'card',id:'test',name:'Sol Ring',type_line:'Artifact',
      legalities:{commander:'legal'},games:['paper']})};});
  assert.equal((await client.named('Sol Ring')).name,'Sol Ring');
  assert.equal((await client.named('Sol Ring')).name,'Sol Ring');
  assert.equal(requests,1);
});
