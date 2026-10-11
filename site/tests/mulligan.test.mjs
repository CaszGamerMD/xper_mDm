import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveDuel} from '../live-match.mjs';
import {RulesDuel} from '../rules-duel.mjs';
import {normalizeMulliganMode,bottomRequired,bottomSelected,chooseBotBottom} from '../mulligan.mjs';

const card=(name,type='Creature — Frog',cmc=2)=>({
  name,type,cmc,mana_cost:'{1}{G}',oracle_text:'',power:'2',toughness:'2',
  quantity:1,keywords:[],color_identity:['G']
});
const forest=card('Forest','Basic Land — Forest',0);
const plains=card('Plains','Basic Land — Plains',0);
function deck(commander='Frog Captain'){
  return {total_cards:100,commander:card(commander,'Legendary Creature — Frog',2),
    groups:[{role:'Lands',cards:[{...forest,quantity:50}]},
      {role:'Spells',cards:Array.from({length:49},(_,i)=>card('Frog '+i))}]};
}
test('friendly and strict exact X-1 rules are explicit',()=>{
  assert.equal(bottomRequired('strict',0),0);
  assert.equal(bottomRequired('strict',1),0);
  assert.equal(bottomRequired('strict',2),1);
  assert.equal(bottomRequired('strict',5),4);
  assert.equal(bottomRequired('friendly',50),0);
  assert.throws(()=>bottomRequired('strict',-1),/Invalid mulligan/);
  assert.throws(()=>normalizeMulliganMode('unlimited'),/Friendly or Strict/);
});
test('bottoming never mutates state on a bad selection and always bottoms the chosen card',()=>{
  const hand=[card('A'),card('B'),card('C'),card('D')],library=[card('top'),card('bottom')];
  assert.throws(()=>bottomSelected(hand,library,[0,0],2),/exactly 2 distinct/);
  assert.throws(()=>bottomSelected(hand,library,[0],2),/exactly 2 distinct/);
  assert.throws(()=>bottomSelected(hand,library,[0,4],2),/exactly 2 distinct/);
  assert.equal(hand.length,4);assert.equal(library.length,2);
  const moved=bottomSelected(hand,library,[1,3],2);
  assert.deepEqual(moved.map(c=>c.name),['B','D']);
  assert.deepEqual(hand.map(c=>c.name),['A','C']);
  assert.deepEqual(library.map(c=>c.name),['top','bottom','B','D']);
});
test('friendly mulligans can happen more than eight times and the player keeps seven',()=>{
  const d=new LiveDuel(deck(),deck('Bot Frog'),{mulliganMode:'friendly',seed:2});
  for(let i=0;i<12;i++)d.mulligan();
  assert.equal(d.view().mulligans,12);
  assert.equal(d.view().canMulligan,true);
  d.keep();
  assert.equal(d.view().phase,'main');
  assert.equal(d.players[0].hand.length,7);
  assert.equal(d.players[0].library.length,92);
});
test('strict mulligan one is free, two needs exactly one bottom',()=>{
  const d=new LiveDuel(deck(),deck('Bot Frog'),{mulliganMode:'strict',seed:3});
  d.mulligan();
  d.keep();
  assert.equal(d.phase,'main');
  assert.equal(d.players[0].hand.length,7);
  const e=new LiveDuel(deck(),deck('Bot Frog'),{mulliganMode:'strict',seed:4});
  e.mulligan();e.mulligan();e.keep();
  assert.equal(e.view().phase,'bottom');
  assert.equal(e.view().bottomRequired,1);
  assert.throws(()=>e.playLand(0),/not available/);
  assert.throws(()=>e.putOnBottom([]),/exactly 1 distinct/);
  const bottomName=e.players[0].hand[3].name;
  e.putOnBottom([3]);
  assert.equal(e.players[0].hand.length,6);
  assert.equal(e.players[0].library.length,93);
  assert.equal(e.players[0].library.at(-1).name,bottomName);
  assert.equal(e.view().phase,'main');
});
test('several strict mulligans: X=5 bottoms exactly four; Rules Lab inherits the same opening rule',()=>{
  const d=new RulesDuel(deck(),deck('Bot Frog'),{mulliganMode:'strict',seed:5});
  for(let i=0;i<5;i++)d.mulligan();
  d.keep();
  assert.equal(d.view().bottomRequired,4);
  assert.equal(d.view().mulligans,5);
  assert.throws(()=>d.putOnBottom([0,1,2]),/exactly 4 distinct/);
  d.putOnBottom([0,1,2,3]);
  assert.equal(d.players[0].hand.length,3);
  assert.equal(d.players[0].library.length,96);
  assert.equal(d.view().phase,'main');
  assert.equal(d.view().rulesLab,true);
});
test('strict cap prevents impossible bottoming eight or more of seven cards',()=>{
  const d=new LiveDuel(deck(),deck('Bot Frog'),{mulliganMode:'strict',seed:6});
  for(let i=0;i<8;i++)d.mulligan();
  assert.equal(d.view().bottomRequired,0);
  assert.equal(d.view().canMulligan,false);
  assert.throws(()=>d.mulligan(),/At most eight Strict/);
  d.keep();
  assert.equal(d.view().bottomRequired,7);
  d.putOnBottom([0,1,2,3,4,5,6]);
  assert.equal(d.players[0].hand.length,0);
});
test('AI bottoms the correct number after automatic strict mulligans',()=>{
  const d=new LiveDuel(deck(),deck('Bot Frog'),{mulliganMode:'strict',seed:7});
  const bot=d.players[1];
  assert.equal(bot.kept,true);
  assert.equal(bot.hand.length,7-Math.max(0,bot.mulligans-1));
  assert.equal(bot.library.length,92+Math.max(0,bot.mulligans-1));
});
test('AI bottom heuristic prefers removing excess lands and expensive spells',()=>{
  const hand=[forest,forest,forest,forest,forest,card('Big Frog','Creature — Frog',7),card('Tiny Frog')];
  const picks=chooseBotBottom(hand,2);
  assert.equal(picks.length,2);
  assert.equal(new Set(picks).size,2);
  assert.ok(picks.every(i=>i<hand.length));
});
