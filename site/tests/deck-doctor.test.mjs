import test from 'node:test';
import assert from 'node:assert/strict';
import {rateDeck,improveCards,DeckDoctor,inferPlan,inferTribes,deckView} from '../deck-doctor.mjs';

const card=(name,type='Creature — Frog',text='',cmc=2,colors=['G'],more={})=>({
  name,oracle_id:name,type_line:type,oracle_text:text,cmc,mana_cost:cmc?'{1}{G}':'',
  color_identity:colors,keywords:[],edhrec_rank:100,produced_mana:type.includes('Land')?['G']:[],
  image:'',url:'',land:type.includes('Land'),basic:type.includes('Basic'),
  creature:type.includes('Creature'),commander:type.includes('Legendary Creature'),
  eligible:true,power:'2',toughness:'2',...more
});
const originalLeader=card('Old Captain','Legendary Creature — Frog','Whenever you attack, scry 1.',3);
const betterLeader=card('Mosswood Captain','Legendary Creature — Frog',
  'Whenever you create a creature token, draw a card. Frogs you control get +1/+1.',3);
const forest=card('Forest','Basic Land — Forest','{T}: Add {G}.',0);
function badDeck(){
  const spells=[];
  for(let i=0;i<20;i++)spells.push(card('Maker '+i,'Creature — Frog','Create a 1/1 green Saproling creature token.'));
  for(let i=0;i<12;i++)spells.push(card('Payoff '+i,'Creature — Frog','Creatures you control get +1/+1.'));
  for(let i=0;i<30;i++)spells.push(card('Vanilla '+i,'Creature — Frog',''));
  return [...Array(37).fill(forest),...spells];
}
const improvements=[
  ...Array.from({length:14},(_,i)=>card('Growth '+i,'Artifact', 'Add {G}.',2)),
  ...Array.from({length:14},(_,i)=>card('Draw '+i,'Sorcery','Draw a card.',2)),
  ...Array.from({length:14},(_,i)=>card('Kill '+i,'Instant','Destroy target creature.',2))
];
class FakeSource{
  constructor(){this.original=badDeck();this.library=new Map([
    [originalLeader.name,originalLeader],[betterLeader.name,betterLeader],
    ...this.original.map(c=>[c.name,c]),...improvements.map(c=>[c.name,c])
  ]);}
  async named(name){return this.library.get(name)||null;}
  async collection(names){return names.map(name=>this.library.get(name)).filter(Boolean);}
  async search(query,limit){
    if(query.includes('is:commander'))return [betterLeader];
    return improvements.slice(0,limit);
  }
}
test('detects the actual token engine and dominant tribe',()=>{
  const cards=badDeck();
  assert.equal(inferPlan(cards,originalLeader),'tokens');
  assert.deepEqual(inferTribes(cards,originalLeader),['Frog']);
});
test('rates role density, coherence, commander and mana curve with transparent categories',()=>{
  const cards=badDeck(),score=rateDeck(cards,originalLeader);
  assert.ok(score.score>=0 && score.score<=100);
  assert.equal(score.lands,37);
  assert.equal(score.average_cmc,2);
  assert.equal(score.roles.ramp,0);
  assert.equal(score.roles.draw,0);
  assert.equal(score.plan,'tokens');
  assert.equal(score.tribes[0],'Frog');
  assert.ok(score.breakdown.engine>0);
});
test('greedy repair never swaps more than requested, never changes commander and preserves 100-card construction',()=>{
  const source=new FakeSource(),before=rateDeck(source.original,originalLeader);
  const tuned=improveCards(source.original,originalLeader,improvements,{maxSwaps:8});
  assert.ok(tuned.swaps.length>0);
  assert.ok(tuned.swaps.length<=8);
  assert.equal(tuned.cards.length,99);
  assert.equal(tuned.commander.name,originalLeader.name);
  assert.ok(tuned.after.score>before.score);
  assert.equal(tuned.remaining,99-tuned.swaps.length);
  assert.equal(tuned.cards.filter(c=>c.name==='Forest').length,37);
  const found=new Set();
  for(const c of tuned.cards)if(!c.basic){assert.ok(!found.has(c.name));found.add(c.name);}
  for(const swap of tuned.swaps)assert.ok(swap.gain>=.65);
});
test('strict zero-swap rating preserves entire list',()=>{
  const cards=badDeck(),tuned=improveCards(cards,originalLeader,improvements,{maxSwaps:0});
  assert.equal(tuned.swaps.length,0);
  assert.deepEqual(tuned.cards.map(c=>c.name),cards.map(c=>c.name));
  assert.equal(tuned.before.score,tuned.after.score);
});
test('cannot add an illegal off-color card or duplicate singleton',()=>{
  const bad=card('Red Pirate','Creature — Pirate','Draw a card.',2,['R']);
  const tuned=improveCards(badDeck(),originalLeader,[bad,...improvements],{maxSwaps:4});
  assert.ok(!tuned.cards.some(c=>c.name==='Red Pirate'));
  assert.throws(()=>improveCards(badDeck(),originalLeader,improvements,{maxSwaps:21}),/between 0 and 20/);
});
test('Deck Doctor import and search: high-threshold commander offer checks exact original 99',async()=>{
  const source=new FakeSource(),doctor=new DeckDoctor(source);
  const input='// Commander\n1 Old Captain\n// Deck\n37 Forest\n'+
    source.original.filter(c=>c.name!=='Forest').map(c=>'1 '+c.name).join('\n');
  const result=await doctor.diagnose(input,{maxSwaps:4,considerCommander:true});
  assert.equal(result.originalDeck.total_cards,100);
  assert.equal(result.upgradedDeck.total_cards,100);
  assert.match(result.upgradedDeck.export,/1 Old Captain/);
  assert.ok(result.upgraded.score>=result.original.score);
  assert.ok(result.swaps.length<=4);
  assert.equal(result.originalCommander,'Old Captain');
  if(result.commanderSuggestion){
    assert.ok(result.commanderSuggestion.gain>=15);
    assert.equal(result.commanderOnlyDeck.commander.name,'Mosswood Captain');
    assert.equal(result.commanderOnlyDeck.total_cards,100);
    assert.ok(result.commanderOnlyDeck.export.includes('1 Mosswood Captain'));
    assert.ok(!result.commanderOnlyDeck.export.includes('1 Old Captain'));
    assert.deepEqual(
      result.commanderOnlyDeck.groups.flatMap(g=>g.cards.map(c=>c.quantity+' '+c.name)).sort(),
      result.originalDeck.groups.flatMap(g=>g.cards.map(c=>c.quantity+' '+c.name)).sort()
    );
  }
});
test('commander disabled means no candidate commander searches or replacements',async()=>{
  const source=new FakeSource(),doctor=new DeckDoctor(source);
  const input='// Commander\n1 Old Captain\n// Deck\n37 Forest\n'+
    source.original.filter(c=>c.name!=='Forest').map(c=>'1 '+c.name).join('\n');
  const r=await doctor.diagnose(input,{maxSwaps:0,considerCommander:false});
  assert.equal(r.commanderSuggestion,null);
  assert.equal(r.original.score,r.upgraded.score);
  assert.equal(r.swaps.length,0);
});
test('misidentified or illegal imported cards stop optimization before any suggestion',async()=>{
  const source=new FakeSource(),doctor=new DeckDoctor(source);
  const input='// Commander\n1 Old Captain\n// Deck\n37 Forest\n'+
    source.original.filter(c=>c.name!=='Forest').map(c=>'1 '+c.name).join('\n');
  await assert.rejects(()=>doctor.diagnose(input.replace('1 Vanilla 0','1 Imaginary Card')),
    /Cannot verify this card/);
  const offcolor=card('Off Color','Creature — Goblin','',2,['R']);
  source.library.set(offcolor.name,offcolor);
  await assert.rejects(()=>doctor.diagnose(input.replace('1 Vanilla 0','1 Off Color')),
    /illegal in the selected commander identity/);
});


test('20-swap setting bounds pair evaluations, keeps a legal 100-card deck, and is not a quota',()=>{
  const original=badDeck();
  const pool=[...improvements,
    ...Array.from({length:160},(_,i)=>card('Generic '+i,'Artifact','Draw a card.',3))];
  const proposed=improveCards(original,originalLeader,pool,{maxSwaps:20});
  assert.equal(proposed.cards.length,99);
  assert.equal(proposed.commander.name,originalLeader.name);
  assert.ok(proposed.swaps.length<=20);
  assert.ok(proposed.evaluations<=20*36*32,
    'The search should examine bounded candidate pairs rather than every card against the whole pool.');
  assert.ok(proposed.swaps.every(s=>s.evidence));
  assert.ok(proposed.after.score>=proposed.before.score);
  const seen=new Set();
  for(const c of proposed.cards)if(!c.basic){
    assert.ok(!seen.has(c.name));
    seen.add(c.name);
  }
});
test('protect known token enablers and payoffs when fixing missing roles',()=>{
  const original=badDeck();
  const proposed=improveCards(original,originalLeader,improvements,{maxSwaps:12});
  assert.ok(proposed.swaps.every(s=>!/^Maker |^Payoff /.test(s.out)),
    'Do not dismantle recognized card engines for generic structural points');
});
test('land shortage warnings and optimizer target align on the same rating',()=>{
  const commander={...originalLeader,cmc:5,mana_cost:'{3}{G}{G}'};
  const other=badDeck().filter(c=>c.name!=='Forest');
  const fillers=Array.from({length:69-other.length},(_,i)=>card('Filler '+i));
  const list=[...Array(30).fill(forest),...other,...fillers];
  assert.equal(list.length,99);
  const rated=rateDeck(list,commander);
  assert.ok(rated.land_target>30);
  assert.ok(rated.warnings.some(w=>w.includes('Add '+(rated.land_target-rated.lands)+' land')));
  const repaired=improveCards(list,commander,[forest],{maxSwaps:20});
  assert.ok(repaired.after.lands>30,'Land-short decks should get real spell→land recommendations');
  assert.ok(repaired.after.lands<=repaired.after.land_target);
  assert.ok(repaired.swaps.every(s=>s.reason==='Land count correction'));
  assert.ok(repaired.after.score>rated.score);
});
test('responsive Deck Doctor optimize yields progress during extensive tuning',async()=>{
  const source=new FakeSource();
  const doctor=new DeckDoctor(source);
  const input='// Commander\n1 Old Captain\n// Deck\n37 Forest\n'+
    source.original.filter(c=>c.name!=='Forest').map(c=>'1 '+c.name).join('\n');
  const messages=[];
  const result=await doctor.diagnose(input,{maxSwaps:20,considerCommander:false},msg=>messages.push(msg));
  assert.ok(messages.some(msg=>msg.includes('Checking verified swaps'))||result.swaps.length===0);
  assert.ok(result.swaps.length<=20);
});
